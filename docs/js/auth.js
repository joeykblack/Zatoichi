/**
 * auth.js — OGS OAuth 2.0 PKCE authentication
 *
 * Exports:
 *   login()              — redirect to OGS authorization page
 *   handleCallback()     — exchange code for token; returns user object or null
 *   logout()             — clear all stored credentials
 *   validateToken()      — check stored token works; refresh if needed; returns user or null
 *   getToken()           — return stored access token or null
 *   getUser()            — return stored user object or null
 */

import { OGS_CLIENT_ID, REDIRECT_URI } from './config.js';

const OGS_AUTHORIZE_URL = 'https://online-go.com/oauth2/authorize/';
const OGS_TOKEN_URL     = 'https://online-go.com/oauth2/token/';
const OGS_API_BASE      = 'https://online-go.com/api/v1';

const STORAGE_TOKEN   = 'zatoichi_token';
const STORAGE_REFRESH = 'zatoichi_refresh';
const STORAGE_USER    = 'zatoichi_user';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function randomBase64url(byteLength) {
  const arr = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64url(plain) {
  const data   = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Token storage ─────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem(STORAGE_TOKEN);
}

export function getUser() {
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveCredentials(data, user) {
  localStorage.setItem(STORAGE_TOKEN, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(STORAGE_REFRESH, data.refresh_token);
  }
  localStorage.setItem(STORAGE_USER, JSON.stringify({
    id:       user.id,
    username: user.username,
  }));
}

export function logout() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_REFRESH);
  localStorage.removeItem(STORAGE_USER);
}

// ── Login (redirect) ──────────────────────────────────────────────────────────

export async function login() {
  if (OGS_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    throw new Error('OGS_CLIENT_ID is not set. Edit docs/js/config.js.');
  }

  const verifier  = randomBase64url(32);
  const challenge = await sha256Base64url(verifier);
  const state     = randomBase64url(16);

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state',    state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             OGS_CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 'read write',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${OGS_AUTHORIZE_URL}?${params}`;
}

// ── Callback (code exchange) ──────────────────────────────────────────────────

/**
 * Call on every page load. If a ?code= param is present, exchange it for a
 * token, store credentials, and return the user object. Returns null otherwise.
 * @returns {Promise<{id:number, username:string}|null>}
 */
export async function handleCallback() {
  const params   = new URLSearchParams(window.location.search);
  const code     = params.get('code');
  const retState = params.get('state');

  if (!code) return null;

  // Clean the URL immediately so a reload doesn't re-attempt the exchange
  window.history.replaceState({}, document.title, window.location.pathname);

  const verifier   = sessionStorage.getItem('pkce_verifier');
  const savedState = sessionStorage.getItem('pkce_state');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');

  if (retState !== savedState) {
    console.error('auth.js: OAuth state mismatch — possible CSRF');
    return null;
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     OGS_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    code,
    code_verifier: verifier,
  });

  const resp = await fetch(OGS_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!resp.ok) {
    console.error('auth.js: token exchange failed', resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const user = await _fetchMe(data.access_token);
  if (!user) return null;

  saveCredentials(data, user);
  return { id: user.id, username: user.username };
}

// ── Token validation & refresh ────────────────────────────────────────────────

/**
 * Validate the stored access token by calling /me.
 * If the call fails and a refresh token is available, attempt a refresh.
 * Returns the user object if valid, or null if the user must log in again.
 * @returns {Promise<{id:number, username:string}|null>}
 */
export async function validateToken() {
  const token = getToken();
  if (!token) return null;

  const user = await _fetchMe(token);
  if (user) return { id: user.id, username: user.username };

  // Token invalid — try refreshing
  const refreshToken = localStorage.getItem(STORAGE_REFRESH);
  if (!refreshToken) { logout(); return null; }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     OGS_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const resp = await fetch(OGS_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!resp.ok) {
    console.warn('auth.js: token refresh failed — user must log in again');
    logout();
    return null;
  }

  const data      = await resp.json();
  const freshUser = await _fetchMe(data.access_token);
  if (!freshUser) { logout(); return null; }

  saveCredentials(data, freshUser);
  return { id: freshUser.id, username: freshUser.username };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _fetchMe(token) {
  try {
    const resp = await fetch(`${OGS_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}
