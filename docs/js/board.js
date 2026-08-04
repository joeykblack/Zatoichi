/**
 * board.js — Optional board display (text and graphical)
 *
 * Phase 8 implementation.
 * Both renderers are purely supplementary — removing them does not affect
 * voice gameplay.
 *
 * Exports:
 *   renderTextBoard(moves, size)          — returns a <pre>-friendly string
 *   renderCanvas(moves, size, canvasEl)   — draws on a provided <canvas>
 */

// ── Text board ───────────────────────────────────────────────────────────────

const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';

/**
 * Build a text representation of the board.
 * @param {{ ogsCoord: string, color: 'black'|'white' }[]} moves
 * @param {number} size  Board size (9, 13, or 19)
 * @returns {string}
 */
export function renderTextBoard(moves, size) {
  // Initialise empty board
  const grid = Array.from({ length: size }, () => Array(size).fill('.'));

  for (const { ogsCoord, color } of moves) {
    if (!ogsCoord || ogsCoord === '.') continue;
    const col = ogsCoord.charCodeAt(0) - 97;
    const row = ogsCoord.charCodeAt(1) - 97;
    if (col >= 0 && col < size && row >= 0 && row < size) {
      grid[row][col] = color === 'black' ? '●' : '○';
    }
  }

  const colHeader = '   ' + GTP_COLS.slice(0, size).split('').join(' ');
  const rows = [];

  for (let r = size - 1; r >= 0; r--) {
    const rowNum = String(r + 1).padStart(2, ' ');
    rows.push(`${rowNum} ${grid[r].join(' ')}`);
  }

  return [colHeader, ...rows].join('\n');
}

// ── Canvas board ─────────────────────────────────────────────────────────────

const STONE_COLORS = {
  black: '#1a1a1a',
  white: '#f0ead6',
};
const BOARD_COLOR  = '#dcb572';
const LINE_COLOR   = '#8b6914';

/**
 * Draw the current board position on a canvas element.
 * @param {{ ogsCoord: string, color: 'black'|'white' }[]} moves
 * @param {number} size
 * @param {HTMLCanvasElement} canvasEl
 */
export function renderCanvas(moves, size, canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const W = canvasEl.width;
  const H = canvasEl.height;
  const pad = W * 0.06;
  const cell = (W - pad * 2) / (size - 1);

  // Background
  ctx.fillStyle = BOARD_COLOR;
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i++) {
    const x = pad + i * cell;
    const y = pad + i * cell;
    ctx.beginPath(); ctx.moveTo(x, pad);      ctx.lineTo(x, H - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, y);      ctx.lineTo(W - pad, y); ctx.stroke();
  }

  // Star points
  const starRadius = cell * 0.1;
  const starPoints = getStarPoints(size);
  ctx.fillStyle = LINE_COLOR;
  for (const [sc, sr] of starPoints) {
    const x = pad + sc * cell;
    const y = pad + (size - 1 - sr) * cell;
    ctx.beginPath();
    ctx.arc(x, y, starRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stones
  for (const { ogsCoord, color } of moves) {
    if (!ogsCoord || ogsCoord === '.') continue;
    const col = ogsCoord.charCodeAt(0) - 97;
    const row = ogsCoord.charCodeAt(1) - 97;
    if (col < 0 || col >= size || row < 0 || row >= size) continue;

    const x = pad + col * cell;
    const y = pad + (size - 1 - row) * cell;
    const r = cell * 0.46;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = STONE_COLORS[color];
    ctx.fill();
    ctx.strokeStyle = color === 'black' ? '#444' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStarPoints(size) {
  if (size === 9)  return [[2,2],[6,2],[4,4],[2,6],[6,6]];
  if (size === 13) return [[3,3],[9,3],[6,6],[3,9],[9,9]];
  if (size === 19) return [
    [3,3],[9,3],[15,3],
    [3,9],[9,9],[15,9],
    [3,15],[9,15],[15,15],
  ];
  return [];
}
