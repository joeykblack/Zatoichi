/**
 * app.js — Top-level application init, state management, and view switching.
 *
 * Phase 1: scaffold only.
 *   - Registers service worker
 *   - Checks TTS / STT support and reports in UI
 *   - Manages view switching
 *   - Holds the central AppState object
 *   - Wires up stub button handlers (login, logout, start game, speak, pass, resign)
 */

import { speak, hasTTS, hasSTT, listenForMove, stopListening } from './voice.js';
import { coordToSpoken, parseSpokenMove } from './coords.js';

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
  const isFirefox  = navigator.userAgent.includes('Firefox');

  if (ttsStatus) {
    if (hasTTS()) {
      ttsStatus.textContent = isFirefox
        ? 'available (system voice — may sound robotic)'
        : 'available ✓';
      ttsStatus.className = isFirefox ? 'warn' : 'ok';
    } else {
      ttsStatus.textContent = 'not available';
      ttsStatus.className = 'warn';
    }
  }

  if (sttStatus) {
    if (hasSTT()) {
      sttStatus.textContent = 'available ✓';
      sttStatus.className = 'ok';
    } else {
      sttStatus.textContent = isFirefox
        ? 'not supported in Firefox — use Chrome or Chromium'
        : 'not available';
      sttStatus.className = 'warn';
    }
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
  document.getElementById('btn-login')?.addEventListener('click', () => {
    // Phase 2 will call auth.login()
    speak('Login is not yet implemented. Coming in phase two.');
    console.log('btn-login clicked (stub)');
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    state.auth = null;
    speak('Logged out.');
    showView('login');
    console.log('btn-logout clicked (stub)');
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

function init() {
  registerServiceWorker();
  checkVoiceCapabilities();
  wireButtons();

  // Show browser compatibility warning if STT is not available
  if (!hasSTT()) {
    const isFirefox = navigator.userAgent.includes('Firefox');
    showCompatWarning(
      isFirefox
        ? 'Firefox does not support speech recognition on Linux. Please use Chrome or Chromium for the full voice experience.'
        : 'Your browser does not support speech recognition. Please use Chrome or Chromium.'
    );
  }

  // Determine initial view from persisted auth token (Phase 2 will handle this properly)
  const token = localStorage.getItem('zatoichi_token');
  if (token) {
    showView('lobby');
  } else {
    showView('login');
  }

  // Announce app ready (small delay to let TTS engine load)
  setTimeout(() => {
    speak('Zatoichi. Voice Go for O G S.');
  }, 800);

  console.log('Zatoichi app initialised.');
}

document.addEventListener('DOMContentLoaded', init);
