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
 */

export const OGS_CLIENT_ID = 'JZvFf6BlkQ2X1PDttmTeDkcAfqEQb1oLoKy5A3Lk';

/**
 * Computed automatically from the current page URL so it works on both
 * localhost and GitHub Pages without any manual changes.
 */
export const REDIRECT_URI = `${location.origin}${location.pathname}`;
