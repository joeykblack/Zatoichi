/**
 * clock.js — OGS clock announcements for byoyomi and main-time.
 *
 * Announcements:
 *   - Main time: every whole minute (10m, 9m, … 1m remaining)
 *   - Entering byoyomi: "Byoyomi. 30 seconds."
 *   - Byoyomi periods left: "Two periods remaining." etc.
 *   - Last 10 seconds: spoken countdown 10 … 1
 */

import { speak } from './voice.js';

// ── Internal state ────────────────────────────────────────────────────────────

let _tickInterval  = null;   // setInterval handle for the 1-second ticker
let _countdownSaid = new Set(); // which countdown values have been spoken

// The current "my" clock snapshot from the last game/clock event.
// Shape mirrors the OGS clock payload's black_time / white_time.
let _myTime = null;  // { thinking_time, periods, period_time } or null
let _inByoyomi = false;

// Thresholds (in seconds) at which to announce main-time minutes remaining.
const MAIN_TIME_ANNOUNCE_MINS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
let _announcedMinutes = new Set();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Update the clock from a game/clock socket event.
 * Call this every time a clock event arrives.
 *
 * @param {object} clockData   Raw OGS clock payload
 * @param {number} myId        The logged-in player's OGS user ID
 * @param {string} myColor     'black' | 'white'
 * @param {boolean} isMyTurn   Whether it is currently the player's turn
 */
export function updateClock(clockData, myId, myColor, isMyTurn) {
  stopClock();

  if (!isMyTurn) return;  // only track time when it's our turn

  const myTime = myColor === 'black' ? clockData.black_time : clockData.white_time;
  if (!myTime) return;

  _myTime         = { ...myTime };
  _inByoyomi      = (_myTime.thinking_time === 0);
  _announcedMinutes = new Set();
  _countdownSaid  = new Set();

  // Announce entering byoyomi immediately if we just entered it
  if (_inByoyomi) {
    const periods = _myTime.periods ?? 1;
    const pt      = _myTime.period_time ?? 30;
    if (periods > 1) {
      speak(`Byoyomi. ${periods} periods of ${pt} seconds.`);
    } else {
      speak(`Byoyomi. ${pt} seconds.`);
    }
  }

  _startTicker();
}

/**
 * Stop all clock tracking and announcements.
 * Call on game over, disconnect, or when it becomes the opponent's turn.
 */
export function stopClock() {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
  _myTime    = null;
  _inByoyomi = false;
  _announcedMinutes = new Set();
  _countdownSaid    = new Set();
}

// ── Internal ticker ───────────────────────────────────────────────────────────

function _startTicker() {
  // Tick once per second; decrement our local copy of the clock
  let lastTick = Date.now();

  _tickInterval = setInterval(() => {
    if (!_myTime) return;

    const now     = Date.now();
    const elapsed = (now - lastTick) / 1000;
    lastTick      = now;

    if (_inByoyomi) {
      _myTime.period_time -= elapsed;

      if (_myTime.period_time <= 0) {
        // Period expired — use next period if available
        const remaining = (_myTime.periods ?? 1) - 1;
        if (remaining > 0) {
          _myTime.periods    = remaining;
          _myTime.period_time = (_myTime.period_time_original ?? 30) + _myTime.period_time;
          _countdownSaid     = new Set();
          if (remaining === 1) {
            speak('Last period.');
          } else {
            speak(`${remaining} periods remaining.`);
          }
        }
        // If remaining === 0 the game will end via socket; no need to announce
        return;
      }

      _announceCountdown(_myTime.period_time);

    } else {
      _myTime.thinking_time -= elapsed;

      if (_myTime.thinking_time <= 0) {
        // Main time just ran out — now in byoyomi
        _myTime.thinking_time = 0;
        _inByoyomi = true;
        _countdownSaid = new Set();
        const periods = _myTime.periods ?? 1;
        const pt      = _myTime.period_time ?? 30;
        if (periods > 1) {
          speak(`Byoyomi. ${periods} periods of ${pt} seconds.`);
        } else {
          speak(`Byoyomi. ${pt} seconds.`);
        }
        return;
      }

      _announceMinutes(_myTime.thinking_time);
    }
  }, 1000);
}

/** Announce whole-minute milestones during main time. */
function _announceMinutes(secondsLeft) {
  for (const mins of MAIN_TIME_ANNOUNCE_MINS) {
    const threshold = mins * 60;
    // Announce when we cross below the threshold for the first time
    if (secondsLeft <= threshold && !_announcedMinutes.has(mins)) {
      _announcedMinutes.add(mins);
      speak(`${mins} minute${mins === 1 ? '' : 's'} remaining.`);
      return;
    }
  }
}

/** Spoken countdown for the last 10 seconds. */
function _announceCountdown(secondsLeft) {
  const s = Math.ceil(secondsLeft);
  if (s <= 10 && s >= 1 && !_countdownSaid.has(s)) {
    _countdownSaid.add(s);
    speak(String(s), { interrupt: false });
  }
}
