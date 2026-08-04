/**
 * ogs.js — OGS REST API client and socket.io live game connector
 *
 * Phase 3 (REST) and Phase 4 (socket.io) implementation.
 *
 * Exports:
 *   fetchMe(token)                                 — GET /api/v1/me
 *   fetchBots(token)                               — GET /api/v1/bots
 *   createBotChallenge(token, botId, options)      — create and accept a bot game
 *   submitMove(token, gameId, ogsCoord)            — POST a move
 *   pass(token, gameId)                            — submit a pass
 *   resign(token, gameId)                          — resign the game
 *   connectToGame(token, gameId, callbacks)        — subscribe to live events
 *   disconnectFromGame()                           — close socket
 */

const OGS_API   = 'https://online-go.com/api/v1';
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
    throw new Error(`OGS API ${path} → ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── REST API ─────────────────────────────────────────────────────────────────

export async function fetchMe(token) {
  return apiFetch(token, '/me');
}

export async function fetchBots(token) {
  const data = await apiFetch(token, '/bots');
  return data.results ?? data;
}

/**
 * Create a bot game challenge and return the game id.
 * @param {string} token
 * @param {number} botId
 * @param {{ boardSize?: number, timeControl?: object, ranked?: boolean }} options
 * @returns {Promise<number>}  game id
 */
export async function createBotChallenge(token, botId, options = {}) {
  const { boardSize = 9, ranked = false } = options;

  const challengeBody = {
    initialized:  false,
    min_ranking:  -1000,
    max_ranking:  1000,
    challenger_color: 'automatic',
    invite_only: false,
    game: {
      name: 'Zatoichi game',
      rules: 'japanese',
      ranked,
      width:  boardSize,
      height: boardSize,
      handicap: 0,
      komi_auto: 'automatic',
      disable_analysis: false,
      initial_state: null,
      private: false,
      time_control: options.timeControl ?? {
        time_control: 'byoyomi',
        main_time: 600,
        periods: 5,
        period_time: 30,
        pause_on_weekends: false,
      },
    },
  };

  // Create challenge directed at the bot
  const challenge = await apiFetch(token, `/challenges`, {
    method: 'POST',
    body: JSON.stringify({ ...challengeBody, player_id: botId }),
  });

  // Accept the challenge (for bot games OGS auto-accepts, but we call accept just in case)
  if (challenge.challenge_id) {
    await apiFetch(token, `/challenges/${challenge.challenge_id}/accept`, {
      method: 'POST',
    }).catch(() => {}); // May 404 if auto-accepted
  }

  return challenge.game ?? challenge.game_id ?? challenge.id;
}

export async function submitMove(token, gameId, ogsCoord) {
  return apiFetch(token, `/games/${gameId}/move`, {
    method: 'POST',
    body: JSON.stringify({ move: ogsCoord }),
  });
}

export async function pass(token, gameId) {
  return submitMove(token, gameId, '.');
}

export async function resign(token, gameId) {
  return apiFetch(token, `/games/${gameId}/resign`, { method: 'POST' });
}

// ── Socket.io live events ────────────────────────────────────────────────────

let _socket = null;

/**
 * Connect to the OGS termination server and subscribe to a game.
 *
 * @param {string} token
 * @param {number} gameId
 * @param {{
 *   onMove: (moveData: object) => void,
 *   onGameData: (gameData: object) => void,
 *   onGameOver: (result: object) => void,
 * }} callbacks
 */
export function connectToGame(token, gameId, callbacks) {
  // socket.io is loaded from CDN in index.html (added in Phase 4)
  if (typeof io === 'undefined') {
    console.error('ogs.js: socket.io not loaded. Add CDN script to index.html.');
    return;
  }

  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(OGS_SOCKET, {
    transports: ['websocket'],
    path: '/socket.io',
  });

  _socket.on('connect', () => {
    console.log('OGS socket connected');
    _socket.emit('authenticate', { bearer: token });
    _socket.emit('game/connect', { game_id: gameId, chat: false });
  });

  _socket.on(`game/${gameId}/move`, data => {
    callbacks.onMove?.(data);
  });

  _socket.on(`game/${gameId}/gamedata`, data => {
    callbacks.onGameData?.(data);
    if (data.phase === 'finished') {
      callbacks.onGameOver?.(data);
    }
  });

  _socket.on('disconnect', () => {
    console.log('OGS socket disconnected');
  });

  _socket.on('connect_error', err => {
    console.error('OGS socket error:', err);
  });
}

export function disconnectFromGame() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
