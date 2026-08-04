/**
 * config.js — App configuration
 *
 * OGS developer page: https://online-go.com/developer
 *
 * Register a Public / Authorization code application with these redirect URIs
 * (add both — OGS allows multiple, one per line):
 *
 *   http://localhost:8000/index.html
 *   https://joeykblack.github.io/Zatoichi/index.html
 *
 * The REDIRECT_URI below must match exactly one of the registered URIs.
 * If you get "Mismatching redirect URI", check what URL is in your browser's
 * address bar when you load the app, and update REDIRECT_URI to match.
 */

export const OGS_CLIENT_ID = 'JZvFf6BlkQ2X1PDttmTeDkcAfqEQb1oLoKy5A3Lk';

/**
 * Must exactly match one of the redirect URIs registered on the OGS developer page.
 * Change this if you are running on a different port or path.
 */
export const REDIRECT_URI = 'http://localhost:8000/index.html';
