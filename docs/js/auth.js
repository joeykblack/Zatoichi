/**
 * auth.js — OGS OAuth 2.0 PKCE authentication
 *
 * Phase 2 implementation.
 * Exports:
 *   login()           — redirect to OGS authorization page
 *   handleCallback()  — exchange code for token, return user info
 *   logout()          — clear stored credentials
 *   getToken()        — return stored access token or null
 *   getUser()         — return stored user object or null
 */

// TODO: Register your app on OGS (https://online-go.com/developer) and set these.
const OGS_CLIENT_ID = 'YOUR_CLIENT_ID';
const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';

const OGS_AUTHORIZE_URL = 'https://online-go.com/oauth2/authorize/';
const OGS_TOKEN_URL     = 'https://online-go.com/oauth2/token/';
const OGS_API_BASE      = 'https://online-go.com/api/v1';

const STORAGE_TOKEN = 'zatoichi_token';
const STORAGE_USER  = 'zatoichi_user';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function randomBase64url(byteLength) {
  const arr = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64url(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem(STORAGE_TOKEN);
}

export function getUser() {
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function login() {
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

export async function handleCallback() {
  const params   = new URLSearchParams(window.location.search);
  const code     = params.get('code');
  const retState = params.get('state');

  if (!code) return null;

  const verifier  = sessionStorage.getItem('pkce_verifier');
  const savedState = sessionStorage.getItem('pkce_state');

  if (retState !== savedState) {
    console.error('auth.js: state mismatch — possible CSRF');
    return null;
  }

  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');

  // Clean up URL
  window.history.replaceState({}, document.title, window.location.pathname);

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     OGS_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    code,
    code_verifier: verifier,
  });

  const resp = await fetch(OGS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    console.error('auth.js: token exchange failed', await resp.text());
    return null;
  }

  const data = await resp.json();
  localStorage.setItem(STORAGE_TOKEN, data.access_token);

  // Fetch user info
  const userResp = await fetch(`${OGS_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!userResp.ok) return null;

  const user = await userResp.json();
  localStorage.setItem(STORAGE_USER, JSON.stringify({
    id:       user.id,
    username: user.username,
  }));

  return user;
}

export function logout() {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}
