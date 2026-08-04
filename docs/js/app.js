/**
 * app.js — Top-level application init, state management, and view switching.
 *
 * Phase 2: OGS OAuth authentication.
 *   - Handles OAuth callback on page load
 *   - Login button triggers PKCE redirect
 *   - Token validated on every load; refreshed automatically
 *   - Username announced and shown in lobby after login
 */

import { speak, hasTTS, hasSTT, listenForMove, stopListening } from './voice.js';
import { coordToSpoken, parseSpokenMove } from './coords.js';
import { login, logout, handleCallback, validateToken, getUser } from './auth.js';
import { OGS_CLIENT_ID } from './config.js';

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

/**
 * Submit a player move. In Phase 1 this just logs and announces.
 * Phase 5 will call ogs.submitMove().
 */
function submitPlayerMove(ogsCoord, gtp) {
  const boardSize = state.game?.boardSize ?? 9;
  const spoken = coordToSpoken(ogsCoord, boardSize);
  speak(`You played ${spoken}.`);
  addMoveHistoryEntry(`You: ${gtp ?? spoken}`, 'you');
  console.log('submitPlayerMove (stub):', ogsCoord);
}

function handlePass() {
  speak('You pass.');
  addMoveHistoryEntry('You: pass', 'you');
  console.log('handlePass (stub)');
}

function handleResign() {
  speak('You resign.');
  addMoveHistoryEntry('You: resign', 'you');
  console.log('handleResign (stub)');
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
    speak('Redirecting to O G S to log in.');
    try {
      await login();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Log in with OGS';
      showLoginError(e.message);
      speak('Login failed. ' + e.message);
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    logout();
    state.auth = null;
    speak('Logged out.');
    showView('login');
  });

  // Start game
  document.getElementById('btn-start-game')?.addEventListener('click', () => {
    // Phase 3 will call ogs.createBotChallenge()
    speak('Creating a game is not yet implemented. Coming in phase three.');
    console.log('btn-start-game clicked (stub)');
  });

  // Speak move
  document.getElementById('btn-speak')?.addEventListener('click', handleSpeakButton);

  // Pass
  document.getElementById('btn-pass')?.addEventListener('click', handlePass);

  // Resign
  document.getElementById('btn-resign')?.addEventListener('click', handleResign);

  // New game
  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    state.game = null;
    showView('lobby');
    speak('Starting a new game.');
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

  // Announce app loading
  setTimeout(() => speak('Zatoichi. Voice Go for O G S.'), 800);

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
function onLoggedIn(user) {
  state.auth = { accessToken: getUser()?.accessToken ?? '', userId: user.id, username: user.username };

  // Populate lobby
  const usernameEl = document.getElementById('lobby-username');
  if (usernameEl) usernameEl.textContent = user.username;

  showView('lobby');
  speak(`Welcome, ${user.username}. Ready to play.`);
  console.log('Logged in as', user.username);
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

document.addEventListener('DOMContentLoaded', init);
