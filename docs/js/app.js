/**
 * app.js — Top-level application init, state management, and view switching.
 *
 * Phase 4: Live game — receive and announce moves via OGS socket.io.
 */

import { speak, hasTTS, hasSTT, listenForMove, stopListening } from './voice.js';
import { coordToSpoken, parseSpokenMove } from './coords.js';
import { login, logout, handleCallback, validateToken, getUser, getToken } from './auth.js';
import { OGS_CLIENT_ID } from './config.js';
import { fetchBots, createBotChallenge, fetchGame, fetchUiConfig, connectToGame, disconnectFromGame,
         submitMove, pass as ogsPass, resign as ogsResign } from './ogs.js';
import { updateClock, stopClock } from './clock.js';

// ── App State ────────────────────────────────────────────────────────────────

export const state = {
  /** @type {{ accessToken: string, userId: number, username: string }|null} */
  auth: null,

  /** @type {{ id: number, botName: string, boardSize: number, playerColor: string, moves: string[], phase: string, result: string|null }|null} */
  game: null,

  ui: {
    listeningForMove: false,
    boardVisible: false,
    graphicalBoardVisible: false,
  },
};

// ── View switching ───────────────────────────────────────────────────────────

const VIEWS = ['login', 'lobby', 'game', 'result'];

/**
 * Show a named view and hide all others.
 * @param {'login'|'lobby'|'game'|'result'} name
 */
export function showView(name) {
  for (const id of VIEWS) {
    const el = document.getElementById(`view-${id}`);
    if (!el) continue;
    el.classList.toggle('active', id === name);
  }

  // Move keyboard focus to the view heading for screen-reader announcement
  const heading = document.querySelector(`#view-${name} h2`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

// ── Service worker ───────────────────────────────────────────────────────────

function registerServiceWorker() {
  const swStatus = document.getElementById('sw-status-text');

  if (!('serviceWorker' in navigator)) {
    if (swStatus) {
      swStatus.textContent = 'not supported';
      swStatus.className = 'warn';
    }
    return;
  }

  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (swStatus) {
      swStatus.textContent = 'registered ✓';
      swStatus.className = 'ok';
    }
    console.log('SW registered:', reg.scope);
  }).catch(err => {
    if (swStatus) {
      swStatus.textContent = 'failed';
      swStatus.className = 'warn';
    }
    console.error('SW registration failed:', err);
  });
}

// ── Voice capability check ───────────────────────────────────────────────────

function checkVoiceCapabilities() {
  const ttsStatus = document.getElementById('tts-status-text');
  const sttStatus = document.getElementById('stt-status-text');

  if (ttsStatus) {
    ttsStatus.textContent = hasTTS() ? 'available ✓' : 'not available';
    ttsStatus.className   = hasTTS() ? 'ok' : 'warn';
  }

  if (sttStatus) {
    sttStatus.textContent = hasSTT() ? 'available ✓' : 'not available — use Chrome';
    sttStatus.className   = hasSTT() ? 'ok' : 'warn';
  }
}

// ── Compatibility warning ────────────────────────────────────────────────────

function showCompatWarning(message) {
  let banner = document.getElementById('compat-warning');
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

// ── Move history helpers ─────────────────────────────────────────────────────

/**
 * Append an entry to the move history list.
 * @param {string} text
 * @param {'you'|'opp'|'info'} type
 */
export function addMoveHistoryEntry(text, type = 'info') {
  const list = document.getElementById('move-history');
  if (!list) return;
  const li = document.createElement('li');
  li.className = type;
  li.textContent = text;
  list.appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}

// ── Game UI helpers ──────────────────────────────────────────────────────────

function setGameControlsEnabled(enabled) {
  document.getElementById('btn-speak').disabled = !enabled;
  document.getElementById('btn-pass').disabled = !enabled;
  document.getElementById('btn-resign').disabled = !enabled;
}

function setListenStatus(text, active = false) {
  const el = document.getElementById('listen-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('listening', active);
}

// ── Speak-move flow ──────────────────────────────────────────────────────────

function handleSpeakButton() {
  if (state.ui.listeningForMove) {
    stopListening();
    state.ui.listeningForMove = false;
    setListenStatus('');
    return;
  }

  state.ui.listeningForMove = true;
  setListenStatus('🎤 Listening…', true);
  speak('Speak your move.', { interrupt: true });

  listenForMove(
    // onResult
    transcript => {
      state.ui.listeningForMove = false;
      setListenStatus('');
      console.log('STT transcript:', transcript);

      const result = parseSpokenMove(transcript, state.game?.boardSize ?? 9);

      if (result.type === 'pass') {
        handlePass();
        return;
      }
      if (result.type === 'resign') {
        handleResign();
        return;
      }
      if (result.type === 'cancel') {
        speak('Cancelled.');
        return;
      }
      if (result.type === 'move' && result.ogsCoord) {
        submitPlayerMove(result.ogsCoord, result.gtp);
        return;
      }

      // Unrecognised
      speak(`Sorry, I didn't understand "${transcript}". Please try again.`);
      setListenStatus('Not recognised — try again');
    },
    // onError
    errorCode => {
      state.ui.listeningForMove = false;
      setListenStatus('');

      if (errorCode === 'not-supported') {
        speak('Speech recognition is not supported in this browser.');
        return;
      }
      if (errorCode === 'no-speech') {
        speak('No speech detected. Please try again.');
        return;
      }
      speak(`Microphone error: ${errorCode}. Please try again.`);
      console.warn('STT error:', errorCode);
    },
    // onStart
    () => {
      setListenStatus('🎤 Listening…', true);
    }
  );
}

// ── Game actions (stubs — wired up in Phase 5) ───────────────────────────────

// Tracks a pending move submission so handleIncomingMove can confirm/cancel it.
let _pendingMove = null; // { ogsCoord, spoken, gtp, timer }

/**
 * Submit a player move and wait for server confirmation.
 * Speaks confirmation when the server echoes the move back via handleIncomingMove.
 * Announces "invalid move" if the server sends a game/error event.
 */
function submitPlayerMove(ogsCoord, gtp) {
  const token     = getToken();
  const gameId    = state.game?.id;
  const boardSize = state.game?.boardSize ?? 9;
  const spoken    = coordToSpoken(ogsCoord, boardSize);

  if (_pendingMove) {
    clearTimeout(_pendingMove.timer);
    _pendingMove = null;
  }

  try {
    submitMove(token, gameId, ogsCoord, boardSize);
  } catch (e) {
    console.error('submitMove failed:', e);
    speak('Sorry, failed to submit that move. Please try again.');
    return;
  }

  // Fallback timeout in case the server never responds at all
  const timer = setTimeout(() => {
    if (_pendingMove?.ogsCoord === ogsCoord) {
      _pendingMove = null;
      speak(`Move timed out. Please try again.`);
    }
  }, 5000);

  _pendingMove = { ogsCoord, spoken, gtp: gtp ?? spoken, timer };
}

/** Called by the game/error socket event — server rejected the move. */
function handleMoveError(errMsg) {
  if (!_pendingMove) return;
  clearTimeout(_pendingMove.timer);
  const { spoken } = _pendingMove;
  _pendingMove = null;

  // Parse a readable reason from the error string if possible
  let reason = '';
  if (/stone_already_placed/i.test(errMsg))  reason = 'There is already a stone there.';
  else if (/ko/i.test(errMsg))               reason = 'That move is not allowed due to ko.';
  else if (/suicide/i.test(errMsg))          reason = 'That move would be suicide.';
  else if (/not_your_turn/i.test(errMsg))    reason = 'It is not your turn.';

  const announcement = reason
    ? `Invalid move at ${spoken}. ${reason} Please try again.`
    : `Invalid move at ${spoken}. Please try again.`;
  speak(announcement);
}

/** Called on every game/clock socket event. */
function handleClock(clockData) {
  if (!state.game || !state.auth) return;

  const myId    = state.auth.userId;
  const myColor = state.game.playerColor;

  // Determine whose turn it is from current_player in the clock payload
  const currentPlayer = clockData.current_player;
  const isMyTurn = Number(currentPlayer) === Number(myId);

  if (!isMyTurn) {
    stopClock();
    return;
  }

  // Store period_time_original so the ticker can reset it each period
  const myTime = myColor === 'black' ? clockData.black_time : clockData.white_time;
  if (myTime && myTime.period_time !== undefined) {
    myTime.period_time_original = myTime.period_time;
  }

  updateClock(clockData, myId, myColor, isMyTurn);
}

function handlePass() {
  const token  = getToken();
  const gameId = state.game?.id;

  try {
    ogsPass(token, gameId);
  } catch (e) {
    console.error('pass failed:', e);
    speak('Sorry, failed to submit pass. Please try again.');
    return;
  }
  speak('You pass.');
  addMoveHistoryEntry('You: pass', 'you');
}

function handleResign() {
  const token  = getToken();
  const gameId = state.game?.id;

  try {
    ogsResign(token, gameId);
  } catch (e) {
    console.error('resign failed:', e);
    speak('Sorry, failed to resign. Please try again.');
    return;
  }
  speak('You resign.');
  addMoveHistoryEntry('You: resign', 'you');
}

// ── Button wiring ────────────────────────────────────────────────────────────

function wireButtons() {
  // Login
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    if (OGS_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
      speak('O G S client I D is not configured. Please edit docs slash js slash config dot js.');
      showLoginError('OGS Client ID not set. Edit docs/js/config.js — see instructions inside.');
      return;
    }
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Redirecting to OGS…';
    try {
      await login();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Log in with OGS';
      showLoginError(e.message);
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    disconnectFromGame();
    logout();
    state.auth = null;
    state.game = null;
    localStorage.removeItem('zatoichi_game_id');
    showView('login');
  });

  // Start game
  document.getElementById('btn-start-game')?.addEventListener('click', async () => {
    const botSelect  = document.getElementById('bot-select');
    const sizeSelect = document.getElementById('size-select');
    const botId      = parseInt(botSelect?.value, 10);
    const boardSize  = parseInt(sizeSelect?.value ?? '9', 10);

    if (!botId) {
      speak('Please select a bot first.');
      return;
    }

    const btn = document.getElementById('btn-start-game');
    btn.disabled = true;
    btn.textContent = 'Creating game…';

    try {
      const token = getToken();
      const { gameId, playerColor, botName } = await createBotChallenge(
        token, botId, state.auth.userId, { boardSize }
      );

      // Persist game ID so we can reconnect after a reload
      localStorage.setItem('zatoichi_game_id', String(gameId));

      state.game = {
        id:          gameId,
        botName,
        boardSize,
        playerColor,
        moves:       [],
        phase:       'playing',
        result:      null,
      };

      const colorWord = playerColor === 'black' ? 'Black' : 'White';
      document.getElementById('game-heading').textContent =
        `Game vs ${botName} — You are ${colorWord}`;
      document.getElementById('game-info-text').textContent =
        `${boardSize}×${boardSize} · You: ${colorWord} · vs ${botName}`;

      setGameControlsEnabled(true);
      showView('game');
      speak(`Game started. You are playing ${colorWord}.`);
      startGameSession(gameId);

    } catch (err) {
      console.error('createBotChallenge failed:', err);
      showGameError('Failed to create game: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Start Game';
    }
  });

  // Speak move
  document.getElementById('btn-speak')?.addEventListener('click', handleSpeakButton);

  // Pass
  document.getElementById('btn-pass')?.addEventListener('click', handlePass);

  // Resign
  document.getElementById('btn-resign')?.addEventListener('click', handleResign);

  // New game
  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    disconnectFromGame();
    localStorage.removeItem('zatoichi_game_id');
    state.game = null;
    showView('lobby');
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  registerServiceWorker();
  checkVoiceCapabilities();
  wireButtons();

  if (!hasSTT()) {
    showCompatWarning('Speech recognition is not available. Please use Chrome or Chromium.');
  }

  // ── Phase 2: OAuth ──────────────────────────────────────────────────────

  // 1. Handle redirect back from OGS with ?code=
  const callbackUser = await handleCallback();
  if (callbackUser) {
    onLoggedIn(callbackUser);
    return;
  }

  // 2. Check for an existing valid token
  const existingUser = await validateToken();
  if (existingUser) {
    onLoggedIn(existingUser);
    return;
  }

  // 3. No valid auth — show login
  showView('login');
  console.log('Zatoichi app initialised.');
}

/**
 * Called after a successful login or token validation.
 * Populates state, updates UI, and announces the user's name.
 */
async function onLoggedIn(user) {
  state.auth = { accessToken: getToken(), userId: Number(user.id), username: user.username };

  // Populate lobby username
  const usernameEl = document.getElementById('lobby-username');
  if (usernameEl) usernameEl.textContent = user.username;

  // Load bot list
  await loadBots();

  // Reconnect to an in-progress game from a previous session
  const savedGameId = localStorage.getItem('zatoichi_game_id');
  if (savedGameId) {
    try {
      const token = getToken();
      const game  = await fetchGame(token, Number(savedGameId));
      if (game && game.id && !game.ended) {
        const boardSize   = game.width ?? 9;
        state.game = {
          id:          game.id,
          botName:     'Bot',
          boardSize,
          playerColor: 'black', // will be corrected by gamedata event
          moves:       [],
          phase:       'playing',
          result:      null,
        };
        document.getElementById('game-heading').textContent = 'Reconnecting…';
        document.getElementById('game-info-text').textContent = `${boardSize}×${boardSize} · Reconnecting…`;
        setGameControlsEnabled(true);
        showView('game');
        startGameSession(game.id);
        return;
      }
    } catch (e) {
      console.warn('Reconnect failed:', e);
    }
    localStorage.removeItem('zatoichi_game_id');
  }

  showView('lobby');
  console.log('Logged in as', user.username);
}

/**
 * Fetch the bot list from OGS and populate the bot selector.
 */
async function loadBots() {
  const select = document.getElementById('bot-select');
  const btn    = document.getElementById('btn-start-game');
  if (!select) return;

  select.innerHTML = '<option value="">Loading bots…</option>';
  if (btn) btn.disabled = true;

  try {
    const token = getToken();
    const bots  = await fetchBots(token);

    if (!bots.length) {
      select.innerHTML = '<option value="">No bots available</option>';
      return;
    }

    select.innerHTML = bots
      .map(b => `<option value="${b.id}">${b.username}${b.description ? ' — ' + b.description : ''}</option>`)
      .join('');

    if (btn) btn.disabled = false;
    console.log(`Loaded ${bots.length} bots.`);

  } catch (err) {
    console.error('loadBots failed:', err);
    select.innerHTML = '<option value="">Failed to load bots</option>';
  }
}

/**
 * Show an error message on the login view.
 */
function showLoginError(message) {
  let el = document.getElementById('login-error');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function showGameError(message) {
  const el = document.getElementById('game-info-text');
  if (el) el.textContent = message;
  console.error(message);
}

// ── Phase 4: Live game session ──────────────────────────────────────────

/**
 * Open the OGS socket and subscribe to live events for the given game.
 * Called immediately after a new game is created, and on reconnect.
 */
async function startGameSession(gameId) {
  const token    = getToken();
  const userId   = state.auth?.userId;
  const username = state.auth?.username;

  let chatAuth = '';
  try {
    const cfg = await fetchUiConfig(token);
    chatAuth  = cfg.chat_auth ?? cfg.chatAuth ?? '';
    console.log('ui/config chat_auth:', chatAuth ? '(obtained)' : '(missing)');
  } catch (e) {
    console.error('Failed to fetch ui/config:', e);
  }

  connectToGame(token, gameId, userId, username, chatAuth, {
    onGameData:  handleGameData,
    onMove:      handleIncomingMove,
    onMoveError: handleMoveError,
    onGameOver:  handleGameOver,
    onClock:     handleClock,
  });
  console.log('Socket session started for game', gameId);
}

/**
 * Handle the full gamedata event from the socket.
 * Fires on connect and on reconnect — contains the authoritative game state.
 */
function handleGameData(data) {
  if (!state.game) return;
  console.log('gamedata:', data);

  // ── Correct player colour from authoritative data ─────────────────
  const uid     = state.auth?.userId;
  const blackId = data.players?.black?.id ?? data.black;
  const whiteId = data.players?.white?.id ?? data.white;
  if (uid && (blackId || whiteId)) {
    const color = Number(blackId) === Number(uid) ? 'black'
                : Number(whiteId) === Number(uid) ? 'white'
                : state.game.playerColor;
    state.game.playerColor = color;
  }

  // Bot name
  const myColor = state.game.playerColor;
  const botName =
    (myColor === 'black'
      ? data.players?.white?.username
      : data.players?.black?.username) ?? state.game.botName;
  state.game.botName    = botName;
  state.game.boardSize  = data.width ?? state.game.boardSize;
  const boardSize = state.game.boardSize;

  const colorWord = myColor === 'black' ? 'Black' : 'White';
  document.getElementById('game-heading').textContent =
    `Game vs ${botName} — You are ${colorWord}`;
  document.getElementById('game-info-text').textContent =
    `${state.game.boardSize}×${state.game.boardSize} · You: ${colorWord} · vs ${botName}`;

  // ── Replay existing moves silently into history ──────────────────
  const existingMoves = data.moves ?? [];
  const historyList   = document.getElementById('move-history');
  if (historyList) historyList.innerHTML = '';
  state.game.moves = [];

  for (let i = 0; i < existingMoves.length; i++) {
    const [col, rowFromTop, elapsed] = existingMoves[i];
    // OGS row 0 = TOP; flip to our internal bottom=0 convention
    let ogsCoord;
    if (col === null || col === undefined || rowFromTop === -1) {
      ogsCoord = '.';
    } else {
      const row = boardSize - 1 - rowFromTop;
      ogsCoord = String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
    }
    state.game.moves.push(ogsCoord);

    // Determine whose move it was (black moves first, move 0 = black)
    const moveColor  = i % 2 === 0 ? 'black' : 'white';
    const isMyMove   = moveColor === state.game.playerColor;
    const spoken     = coordToSpoken(ogsCoord, state.game.boardSize);
    const label      = isMyMove ? `You: ${spoken}` : `${botName}: ${spoken}`;
    addMoveHistoryEntry(label, isMyMove ? 'you' : 'opp');
  }

  // If it's currently the opponent's turn and there are no pending moves,
  // the last move (if any) was ours — nothing extra to announce on reconnect.
  // If it's our turn, prompt.
  if (data.phase === 'play' || data.phase === 'playing') {
    const moveCount   = existingMoves.length;
    const blackToMove = moveCount % 2 === 0;
    const myTurn      = (state.game.playerColor === 'black' && blackToMove) ||
                        (state.game.playerColor === 'white' && !blackToMove);
    if (myTurn) speak('Your turn.');
  }

  if (data.phase === 'finished') {
    handleGameOver(data);
  }
}

/**
 * Handle a live move event from the socket.
 * Fired for every move including our own.
 */
function handleIncomingMove(data) {
  if (!state.game) return;
  const boardSize = state.game.boardSize ?? 9;
  console.log('incoming move raw:', JSON.stringify(data), 'boardSize:', boardSize);

  // OGS wire format: move is [col, row] where col 0 = left, row 0 = TOP
  // Internal format:  ogsCoord string where row 'a'=0 = BOTTOM
  let ogsCoord;
  if (Array.isArray(data.move)) {
    const [col, rowFromTop] = data.move;
    if (col === null || col === undefined || rowFromTop === -1) {
      ogsCoord = '.';
    } else {
      const rowFromBot = boardSize - 1 - rowFromTop;
      ogsCoord = String.fromCharCode(97 + col) + String.fromCharCode(97 + rowFromBot);
    }
  } else if (typeof data.move === 'string') {
    ogsCoord = data.move; // already internal format
  } else if (data.move && typeof data.move.x === 'number') {
    if (data.move.x === -1) {
      ogsCoord = '.';
    } else {
      const rowFromBot = boardSize - 1 - data.move.y;
      ogsCoord = String.fromCharCode(97 + data.move.x) + String.fromCharCode(97 + rowFromBot);
    }
  } else {
    console.warn('handleIncomingMove: unknown move format', data.move);
    ogsCoord = '.';
  }

  console.log('incoming move decoded:', ogsCoord, '→', coordToSpoken(ogsCoord, boardSize));

  // move_number is 1-based; even = white just moved, odd = black just moved
  const moveNumber = data.move_number ?? (state.game.moves.length + 1);
  const colorThatMoved = moveNumber % 2 === 0 ? 'white' : 'black';
  const isMyMove = colorThatMoved === state.game.playerColor;

  // Avoid duplicate entries from the initial gamedata replay
  if (state.game.moves.length >= moveNumber) return;

  state.game.moves.push(ogsCoord);
  const spoken = coordToSpoken(ogsCoord, state.game.boardSize);

  if (isMyMove) {
    // Server confirmed our move — cancel the rejection timer and announce
    if (_pendingMove) {
      clearTimeout(_pendingMove.timer);
      const label = _pendingMove.gtp ?? spoken;
      _pendingMove = null;
      speak(`You played ${spoken}.`);
      addMoveHistoryEntry(`You: ${label}`, 'you');
    } else {
      // Confirmed move with no pending record (e.g. reconnect replay)
      addMoveHistoryEntry(`You: ${spoken}`, 'you');
    }
  } else {
    // Opponent move — announce it
    const announcement = ogsCoord === '.' ? 'Opponent passes.' : `Opponent plays ${spoken}.`;
    speak(announcement);
    addMoveHistoryEntry(`${state.game.botName}: ${spoken}`, 'opp');
  }
}

/**
 * Handle game-over — announce result and show result view.
 */
function handleGameOver(data) {
  disconnectFromGame();
  stopClock();
  localStorage.removeItem('zatoichi_game_id');
  if (!state.game) return;

  state.game.phase = 'finished';

  // Build result string
  let result = 'Game over.';
  if (data.outcome) {
    result = data.outcome;
  } else if (data.winner !== undefined) {
    const winColor = data.winner === 0 ? 'Black' : 'White';
    result = `${winColor} wins.`;
  }
  state.game.result = result;

  document.getElementById('result-summary').textContent = result;
  speak(result);
  showView('result');
}

document.addEventListener('DOMContentLoaded', init);
