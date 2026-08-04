/**
 * voice.js — Text-to-speech and speech recognition wrappers
 *
 * Exports:
 *   speak(text, options?)     — queue a TTS utterance
 *   cancelSpeech()            — stop all queued speech
 *   listVoices()              — log all available voices to the console (debug)
 *   listenForMove(onResult, onError, onStart?)  — start one STT session
 *   stopListening()           — abort active STT session
 *   hasTTS()                  — returns true if TTS is available
 *   hasSTT()                  — returns true if STT is available
 */

// ── TTS ──────────────────────────────────────────────────────────────────────

/**
 * Returns true if the Web Speech Synthesis API is available.
 */
export function hasTTS() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Known high-quality voice names, in preference order.
 * Checked as case-insensitive substrings against SpeechSynthesisVoice.name.
 * Add more from your platform by running listVoices() in the browser console.
 */
const PREFERRED_VOICE_NAMES = [
  // Linux / Android Chrome (Google network voices — best quality)
  'Google UK English Female',
  'Google UK English Male',
  'Google US English',
  'Google US English 2',
  // Linux speech-dispatcher — SVOX Pico (much better than eSpeak)
  // Install: sudo apt install libttspico-utils speech-dispatcher-pico2wave
  'pico',
  'SVOX',
  // macOS / iOS
  'Samantha',
  'Karen',
  'Daniel',
  'Moira',
  // Windows
  'Microsoft Zira',
  'Microsoft David',
  'Microsoft Mark',
  // Generic quality keywords (last resort before eSpeak)
  'enhanced',
  'premium',
  'neural',
];

/**
 * Voice name patterns to always reject — robotic / unintelligible engines.
 * eSpeak-ng MBROLA voices all contain a '+' character (e.g. "English+RicishayMax").
 * We reject any voice name containing '+' as a reliable eSpeak MBROLA signal.
 */
const REJECTED_VOICE_PATTERNS = [
  /\+/,           // eSpeak MBROLA voices — e.g. "English (America)+RicishayMax"
  /espeak/i,
  /mbrola/i,
  /festival/i,
];

/**
 * Pick the best available English voice.
 * Works through PREFERRED_VOICE_NAMES in order; falls back to any en-* voice.
 * Logs the chosen voice to the console so you can tune the preference list.
 * @returns {SpeechSynthesisVoice|null}
 */
function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const isRejected = v =>
    REJECTED_VOICE_PATTERNS.some(r => r.test(v.name));

  const englishVoices = voices.filter(v => /^en/i.test(v.lang));
  const goodVoices    = englishVoices.filter(v => !isRejected(v));

  for (const preferred of PREFERRED_VOICE_NAMES) {
    const match = goodVoices.find(
      v => v.name.toLowerCase().includes(preferred.toLowerCase())
    );
    if (match) {
      console.log(`voice.js: using voice "${match.name}" (${match.lang})`);
      return match;
    }
  }

  // Last resort: first non-rejected English voice, or any English voice
  const lastResort = goodVoices[0] ?? englishVoices[0];
  if (lastResort) {
    console.log(`voice.js: fallback voice "${lastResort.name}" (${lastResort.lang})`);
    return lastResort;
  }

  console.warn('voice.js: no English voice found, using browser default');
  return null;
}

/**
 * Log all available voices to the browser console.
 * Run this in DevTools to find the best voice name for your device,
 * then add it to PREFERRED_VOICE_NAMES at the top of this file.
 */
export function listVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    console.log('voice.js: no voices loaded yet — try again after speaking once');
    return;
  }
  console.table(
    voices.map((v, i) => ({ index: i, name: v.name, lang: v.lang, local: v.localService, default: v.default }))
  );
}

/**
 * Chrome has a bug where speechSynthesis silently pauses after ~15 seconds.
 * Calling resume() every 10 seconds keeps it alive.
 */
let _resumeTimer = null;

/**
 * Start the Chrome keep-alive only after a delay, so short utterances
 * (move announcements) are never interrupted by a pause/resume cycle.
 * The 14-second delay means the first ping fires at 14 s + 14 s = 28 s,
 * well clear of any normal announcement.
 */
function startResumeKeepAlive() {
  if (_resumeTimer) return;
  _resumeTimer = setInterval(() => {
    if (!window.speechSynthesis.speaking) {
      stopResumeKeepAlive();
      return;
    }
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }, 14_000);
}

function stopResumeKeepAlive() {
  if (_resumeTimer) {
    clearInterval(_resumeTimer);
    _resumeTimer = null;
  }
}

/**
 * Speak a string aloud.
 * Waits for voices to be ready before speaking to avoid the rushed-voice bug.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.rate=0.85]  Speech rate (0.1–10); below 1 is more intelligible
 * @param {number} [options.pitch=1]    Pitch (0–2)
 * @param {number} [options.volume=1]   Volume (0–1)
 * @param {boolean} [options.interrupt=false]  Cancel current speech first
 */
export function speak(text, options = {}) {
  if (!hasTTS()) {
    console.warn('voice.js: TTS not available');
    return;
  }

  const { rate = 0.85, pitch = 1, volume = 1, interrupt = false } = options;

  if (interrupt) window.speechSynthesis.cancel();

  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate   = rate;
    utterance.pitch  = pitch;
    utterance.volume = volume;

    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => startResumeKeepAlive();
    utterance.onend   = () => {
      if (!window.speechSynthesis.speaking) stopResumeKeepAlive();
    };
    utterance.onerror = e => {
      stopResumeKeepAlive();
      // 'interrupted' is expected when we cancel; suppress it
      if (e.error !== 'interrupted') {
        console.warn('voice.js: TTS error', e.error, text);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  // If voices are already loaded, speak immediately.
  // Otherwise wait for the voiceschanged event (fires once on first load).
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true });
  }
}

/**
 * Cancel all queued and in-progress speech.
 */
export function cancelSpeech() {
  if (hasTTS()) {
    stopResumeKeepAlive();
    window.speechSynthesis.cancel();
  }
}

// ── STT ──────────────────────────────────────────────────────────────────────

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Returns true if the Web Speech Recognition API is available.
 */
export function hasSTT() {
  return Boolean(SpeechRecognition);
}

/** Currently active recognition instance, or null. */
let _recognition = null;

/**
 * Start a single speech recognition session.
 * Calls onResult(transcript) with the best result when the session ends.
 * Calls onError(errorCode) if something goes wrong.
 *
 * @param {function} onResult   Called with the recognised transcript string
 * @param {function} onError    Called with the error code string
 * @param {function} [onStart]  Called when the microphone opens
 */
export function listenForMove(onResult, onError, onStart) {
  if (!hasSTT()) {
    onError('not-supported');
    return;
  }

  // Abort any existing session
  if (_recognition) {
    _recognition.abort();
    _recognition = null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  _recognition = recognition;

  recognition.onstart = () => {
    if (onStart) onStart();
  };

  recognition.onresult = event => {
    _recognition = null;
    // Pick the first (highest confidence) alternative
    const transcript = event.results[0][0].transcript;
    onResult(transcript);
  };

  recognition.onerror = event => {
    _recognition = null;
    onError(event.error);
  };

  recognition.onend = () => {
    // If onresult hasn't fired yet, treat as no-speech
    if (_recognition === recognition) {
      _recognition = null;
      onError('no-speech');
    }
  };

  recognition.start();
}

/**
 * Abort the active speech recognition session (if any).
 */
export function stopListening() {
  if (_recognition) {
    _recognition.abort();
    _recognition = null;
  }
}
