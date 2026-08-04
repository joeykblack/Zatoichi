/**
 * ogs.js — OGS REST API client and socket.io live game connector
 *
 * Phase 3: REST client — bots, game creation, move submission.
 * Phase 4: socket.io live events.
 *
 * Exports:
 *   fetchMe(token)                                — GET /api/v1/me
 *   fetchBots(token)                              — GET /api/v1/bots
 *   createBotChallenge(token, botId, userId, options) — create bot game; returns { gameId, playerColor }
 *   fetchGame(token, gameId)                      — GET /api/v1/games/:id
 *   submitMove(token, gameId, ogsCoord)           — POST a move
 *   pass(token, gameId)                           — submit a pass
 *   resign(token, gameId)                         — resign the game
 *   connectToGame(token, gameId, callbacks)       — subscribe to live events
 *   disconnectFromGame()                          — close socket
 */

const OGS_API    = 'https://online-go.com/api/v1';
const OGS_SOCKET = 'https://online-go.com';

// ── REST helpers ─────────────────────────────────────────────────────────────

function authHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(token, path, options = {}) {
  const resp = await fetch(`${OGS_API}${path}`, {
    headers: authHeaders(token),
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OGS ${path} → ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── REST API ─────────────────────────────────────────────────────────────────

export async function fetchMe(token) {
  return apiFetch(token, '/me');
}

/**
 * Return a curated list of well-known, reliably-online OGS bots,
 * sorted from weakest to strongest so beginners see easy options first.
 *
 * Falls back to fetching all bots from /players?is_bot=true if needed.
 * Each item: { id, username, description }
 */
export async function fetchBots(token) {
  // Curated list of bots known to accept challenges reliably.
  // Add/remove as needed. IDs are stable OGS user IDs.
  const KNOWN_BOTS = [
    { id:  605979, username: 'amybot-beginner',         description: 'Beginner (very easy)' },
    { id: 2028889, username: '10k-kgs-humanlike-kata',  description: '10k (beginner friendly)' },
    { id: 2025391, username: '5k-kgs-humanlike-kata',   description: '5k' },
    { id: 2028891, username: '1d-kgs-humanlike-kata',   description: '1 dan' },
    { id: 1004132, username: '9x9Bot',                  description: '9×9 specialist' },
    { id:  342899, username: '9*9 Professional',        description: '9×9 strong' },
    { id:  640435, username: '00bStrongBot',            description: 'Strong bot' },
  ];

  // Verify which bots are still reachable (quick HEAD-style check via /players filter)
  // For now just return the curated list; Phase 7 can add a live lookup.
  return KNOWN_BOTS;
}

/**
 * Fetch a single game by ID.
 */
export async function fetchGame(token, gameId) {
  return apiFetch(token, `/games/${gameId}`);
}

/**
 * Fetch /api/v1/ui/config — contains chat_auth needed for socket authenticate.
 */
export async function fetchUiConfig(token) {
  return apiFetch(token, '/ui/config');
}

/**
 * Create a game challenge directed at a bot and wait for the game to start.
 *
 * Uses POST /api/v1/players/{botId}/challenge — the correct OGS endpoint for
 * directed challenges. The body shape matches what ChallengeModal.tsx sends.
 *
 * @param {string} token
 * @param {number} botId        — OGS user ID of the bot
 * @param {number} userId       — OGS user ID of the logged-in player
 * @param {{ boardSize?: number, ranked?: boolean }} options
 * @returns {Promise<{ gameId: number, playerColor: 'black'|'white', botName: string }>}
 */
export async function createBotChallenge(token, botId, userId, options = {}) {
  const { boardSize = 9, ranked = false } = options;

  const timeControlParameters = {
    time_control:    'byoyomi',
    system:          'byoyomi',
    speed:           'live',
    main_time:       600,
    periods:         5,
    period_time:     30,
    periods_min:     1,
    periods_max:     300,
    pause_on_weekends: false,
  };

  const body = {
    initialized:      false,
    min_ranking:      -1000,
    max_ranking:      1000,
    challenger_color: 'automatic',
    rengo_auto_start: 0,
    invite_only:      false,
    game: {
      name:             'Zatoichi game',
      rules:            'japanese',
      ranked,
      width:            boardSize,
      height:           boardSize,
      handicap:         0,
      komi_auto:        'automatic',
      disable_analysis: false,
      initial_state:    null,
      private:          false,
      rengo:            false,
      rengo_casual_mode: false,
      pause_on_weekends: false,
      time_control:     'byoyomi',
      time_control_parameters: timeControlParameters,
    },
  };

  // POST to players/{botId}/challenge — the correct endpoint for directed challenges
  const res = await apiFetch(token, `/players/${botId}/challenge`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });

  console.log('Challenge response:', JSON.stringify(res, null, 2));

  // Response shape: { challenge: <challenge_id>, game: <game_id_or_obj>, ... }
  const gameId =
    (typeof res.game === 'object' ? res.game?.id : res.game) ??
    res.game_id ??
    res.id;

  if (!gameId) {
    throw new Error('Could not determine game ID from challenge response: ' + JSON.stringify(res));
  }

  // Poll for the game to start (bot may take a moment to accept)
  let game = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    game = await fetchGame(token, gameId);
    const blackId = game.players?.black?.id ?? game.black;
    const whiteId = game.players?.white?.id ?? game.white;
    if (blackId || whiteId) break;
    console.log(`Waiting for game to start… attempt ${attempt + 1}`);
  }

  console.log('Game record (after polling):', JSON.stringify(game, null, 2));

  const blackId =
    game.players?.black?.id ??
    game.black_player_id ??
    game.black ??
    null;
  const whiteId =
    game.players?.white?.id ??
    game.white_player_id ??
    game.white ??
    null;

  const uid = Number(userId);
  console.log(`color check: uid=${uid} blackId=${blackId} whiteId=${whiteId}`);

  const playerColor = Number(blackId) === uid ? 'black'
                    : Number(whiteId) === uid ? 'white'
                    : 'black'; // Phase 4 socket gamedata will correct this if wrong

  const botName =
    (playerColor === 'white' ? game.players?.black?.username : game.players?.white?.username) ??
    'Bot';

  return { gameId, playerColor, botName };
}

/**
 * Submit a move via the socket (OGS does not accept moves via REST).
 * @param {number} gameId
 * @param {string} ogsCoord  internal two-letter coord (row 0 = bottom), e.g. 'dd', or '.' for pass
 * @param {number} boardSize  needed to flip row to OGS wire format (row 0 = top)
 * @param {(error: string) => void} [onError]  called if OGS rejects the move
 */
export function submitMove(token, gameId, ogsCoord, boardSize, onError) {
  if (!_socket) throw new Error('Not connected to a game socket.');
  let wireMove = ogsCoord;
  if (ogsCoord && ogsCoord !== '.' && ogsCoord !== '..' && boardSize) {
    const col        = ogsCoord.charCodeAt(0) - 97;
    const rowFromBot = ogsCoord.charCodeAt(1) - 97;
    const rowFromTop = boardSize - 1 - rowFromBot;
    wireMove = String.fromCharCode(97 + col) + String.fromCharCode(97 + rowFromTop);
  }
  const payload = { game_id: Number(gameId), move: wireMove };
  console.log('emitting game/move:', JSON.stringify(payload));
  _socket.emit('game/move', payload, (ack) => {
    console.log('game/move ack:', JSON.stringify(ack));
    if (ack && (ack.error || ack.rejection)) {
      const msg = ack.error ?? ack.rejection ?? 'Invalid move.';
      console.warn('game/move rejected:', msg);
      onError?.(msg);
    }
  });
}

export function pass(token, gameId) {
  submitMove(token, gameId, '..');
}

export function resign(token, gameId) {
  if (!_socket) throw new Error('Not connected to a game socket.');
  _socket.emit('game/resign', { game_id: gameId });
}

// ── Socket.io live events ─────────────────────────────────────────────────────

let _socket = null;

/**
 * Connect to the OGS termination server and subscribe to a game.
 * Requires socket.io loaded from CDN (added to index.html in Phase 4).
 *
 * @param {string}  token
 * @param {number}  gameId
 * @param {number}  userId
 * @param {string}  username
 * @param {string}  chatAuth   — from GET /api/v1/ui/config .chat_auth
 * @param {{
 *   onMove:     (moveData: object) => void,
 *   onGameData: (gameData: object) => void,
 *   onGameOver: (result: object) => void,
 * }} callbacks
 */
export function connectToGame(token, gameId, userId, username, chatAuth, callbacks) {
  if (typeof io === 'undefined') {
    console.error('ogs.js: socket.io not loaded. Add CDN script to index.html.');
    return;
  }

  if (_socket) { _socket.disconnect(); _socket = null; }

  _socket = io(OGS_SOCKET, {
    transports: ['websocket'],
    path: '/socket.io',
  });

  _socket.on('connect', () => {
    console.log('OGS socket connected, authenticating as', username);
    _socket.emit('authenticate', {
      player_id: Number(userId),
      username:  username,
      auth:      chatAuth,
    }, (authData) => {
      console.log('OGS socket authenticated', authData);
      _socket.emit('game/connect', {
        game_id:   Number(gameId),
        player_id: Number(userId),
        chat:      false,
      });
    });
  });

  _socket.on(`game/${gameId}/move`, data => callbacks.onMove?.(data));

  _socket.on(`game/${gameId}/gamedata`, data => {
    callbacks.onGameData?.(data);
    if (data.phase === 'finished') callbacks.onGameOver?.(data);
  });

  _socket.on('disconnect', () => console.log('OGS socket disconnected'));
  _socket.on('connect_error', err => console.error('OGS socket error:', err));
}

export function disconnectFromGame() {
  if (_socket) { _socket.disconnect(); _socket = null; }
}
