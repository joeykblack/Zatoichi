/**
 * coords.js — Coordinate conversion utilities
 *
 * OGS encodes moves as two lowercase letters, e.g. "dd".
 * Each letter maps to an index: 'a'=0, 'b'=1, … 's'=18.
 * Column 0 = left edge; row 0 = BOTTOM edge (OGS convention).
 *
 * GTP notation:
 *   Columns: A B C D E F G H J K L M N O P Q R S T  (I is skipped)
 *   Rows:    1 (bottom) … 19 (top)
 *
 * Examples (9×9):
 *   "aa" → A1 (bottom-left)
 *   "ee" → E5 (tengen / centre of 9×9)
 *   "ii" → J9 (top-right of 9×9)
 *   "."  → pass
 */

// GTP column letters (I is skipped at index 8, so J=index 8 in this array)
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';

/**
 * Named positions for common board sizes.
 * Values are GTP coordinates (upper-case).
 */
const NAMED_POSITIONS = {
  9: {
    tengen: 'E5',
    'star point': null, // handled dynamically
  },
  13: {
    tengen: 'G7',
  },
  19: {
    tengen: 'K10',
  },
};

// Words used when speaking row numbers
const ROW_WORDS = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

// ── Conversion functions ─────────────────────────────────────────────────────

/**
 * Convert an OGS-encoded coordinate to a GTP string.
 * Returns null for invalid input.
 * @param {string} ogsCoord  e.g. "dd", ".", ""
 * @returns {string|null}    e.g. "D4", "pass", null
 */
export function ogsToGtp(ogsCoord) {
  if (!ogsCoord || ogsCoord === '.') return 'pass';
  if (ogsCoord.length !== 2) return null;

  const col = ogsCoord.charCodeAt(0) - 97; // 'a'=0
  const row = ogsCoord.charCodeAt(1) - 97; // 'a'=0, bottom row

  if (col < 0 || col > 18 || row < 0 || row > 18) return null;

  return `${GTP_COLS[col]}${row + 1}`;
}

/**
 * Convert a GTP coordinate string to an OGS-encoded coordinate.
 * @param {string} gtpCoord  e.g. "D4", "PASS"
 * @returns {string|null}    e.g. "dd", ".", null
 */
export function gtpToOgs(gtpCoord) {
  if (!gtpCoord) return null;
  const upper = gtpCoord.trim().toUpperCase();
  if (upper === 'PASS') return '.';

  const match = upper.match(/^([A-HJ-T])(\d{1,2})$/);
  if (!match) return null;

  const colChar = match[1];
  const row = parseInt(match[2], 10);

  const colIdx = GTP_COLS.indexOf(colChar);
  if (colIdx === -1 || row < 1 || row > 19) return null;

  return `${String.fromCharCode(97 + colIdx)}${String.fromCharCode(97 + row - 1)}`;
}

/**
 * Convert an OGS coordinate to a human-readable spoken string.
 * Recognises tengen for 9×9, 13×13, and 19×19 boards.
 * @param {string} ogsCoord
 * @param {number} [boardSize=9]
 * @returns {string}  e.g. "D four", "tengen", "passes"
 */
export function coordToSpoken(ogsCoord, boardSize = 9) {
  if (!ogsCoord || ogsCoord === '.') return 'passes';

  const gtp = ogsToGtp(ogsCoord);
  if (!gtp) return 'unknown';

  // Check for named positions
  const named = NAMED_POSITIONS[boardSize];
  if (named) {
    for (const [name, coord] of Object.entries(named)) {
      if (coord && coord.toUpperCase() === gtp.toUpperCase()) return name;
    }
  }

  const colChar = gtp[0];
  const rowNum = parseInt(gtp.slice(1), 10);

  return `${colChar}${rowNum}`;
}

/**
 * Parse a spoken transcript into an OGS coordinate.
 * Handles:
 *   - GTP style:  "D four", "Q sixteen", "jay ten"
 *   - Named:      "tengen"
 *   - Commands:   "pass", "resign", "cancel"
 * @param {string} transcript
 * @param {number} [boardSize=9]
 * @returns {{ type: 'move'|'pass'|'resign'|'cancel'|'unknown', ogsCoord?: string, gtp?: string }}
 */
export function parseSpokenMove(transcript, boardSize = 9) {
  const raw = transcript.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');

  // Commands
  if (/\bpass\b/.test(raw)) return { type: 'pass', ogsCoord: '.' };
  if (/\bresign\b/.test(raw)) return { type: 'resign' };
  if (/\bcancel\b/.test(raw)) return { type: 'cancel' };

  // Named positions
  const named = NAMED_POSITIONS[boardSize];
  if (named) {
    for (const [name, coord] of Object.entries(named)) {
      if (coord && raw.includes(name)) {
        return { type: 'move', gtp: coord, ogsCoord: gtpToOgs(coord) };
      }
    }
  }

  // Number words → digits
  const numberWords = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19,
  };

  let normalised = raw;
  for (const [word, digit] of Object.entries(numberWords)) {
    normalised = normalised.replace(new RegExp(`\\b${word}\\b`, 'g'), String(digit));
  }

  // Column letter aliases (for "jay" = J, etc.)
  const colAliases = {
    jay: 'j', 'j': 'j',
    a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g',
    h: 'h', k: 'k', l: 'l', m: 'm', n: 'n', o: 'o', p: 'p',
    q: 'q', r: 'r', s: 's', t: 't',
  };

  // Match: optional "at" + (letter) + (number)
  const coordMatch = normalised.match(/\b([a-hj-t])\s?(\d{1,2})\b/);
  if (coordMatch) {
    const colChar = colAliases[coordMatch[1]] || coordMatch[1];
    const row = parseInt(coordMatch[2], 10);
    const gtp = `${colChar.toUpperCase()}${row}`;
    const ogsCoord = gtpToOgs(gtp);
    if (ogsCoord) return { type: 'move', gtp, ogsCoord };
  }

  return { type: 'unknown' };
}

// ── Self-test (runs only when loaded as the main module in a browser) ────────
// Open the browser console and check for "coords self-test: all passed"
if (import.meta.url === document.currentScript?.src) {
  const tests = [
    [ogsToGtp('aa'), 'A1'],
    [ogsToGtp('dd'), 'D4'],
    [ogsToGtp('ee'), 'E5'],
    [ogsToGtp('.'),  'pass'],
    [gtpToOgs('A1'), 'aa'],
    [gtpToOgs('D4'), 'dd'],
    [gtpToOgs('PASS'), '.'],
    [coordToSpoken('dd', 9),  'D four'],
    [coordToSpoken('ee', 9),  'tengen'],
    [coordToSpoken('.'),      'passes'],
    [parseSpokenMove('D four', 9).ogsCoord,   'dd'],
    [parseSpokenMove('tengen', 9).ogsCoord,   'ee'],
    [parseSpokenMove('pass').type,            'pass'],
    [parseSpokenMove('resign').type,          'resign'],
  ];
  let passed = 0;
  let failed = 0;
  for (const [got, expected] of tests) {
    if (got === expected) {
      passed++;
    } else {
      console.warn(`coords self-test FAIL: got "${got}", expected "${expected}"`);
      failed++;
    }
  }
  if (failed === 0) {
    console.log(`coords self-test: all ${passed} passed ✓`);
  }
}
