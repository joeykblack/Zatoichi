# Zatoichi — Design

## Goal

Build a fully accessible Progressive Web App that allows blind, visually impaired, or blindfolded Go players to play games on OGS using only voice interaction. The app should be usable with zero visual attention and work naturally with mobile screen readers (TalkBack, VoiceOver).

---

## Stack constraints

- Vanilla JavaScript
- No framework
- No bundler / build pipeline
- Static hosting from `docs/` on GitHub Pages

---

## Accessibility-first principles

1. **Voice is the primary interface** — every game action must be achievable by speech alone
2. **TTS is the primary output** — every important event must be spoken aloud without user action
3. **Screen reader compatible** — all interactive elements use semantic HTML, ARIA roles, and visible focus management
4. **Minimal visual UI** — buttons are large, high-contrast, and labelled for TalkBack/VoiceOver
5. **No required visual elements** — the board display is always optional

---

## OGS integration

### Authentication

OGS supports OAuth 2.0. The app will use the OGS OAuth flow to obtain an access token stored in `localStorage`. No password is stored.

- Authorization endpoint: `https://online-go.com/oauth2/authorize/`
- Token endpoint: `https://online-go.com/oauth2/token/`
- Requires registering a client application on OGS (client_id, redirect_uri)

### REST API

Used for account info, game creation, game state, and game actions.

| Action | Endpoint |
|---|---|
| Get current user | `GET /api/v1/me` |
| List bots | `GET /api/v1/bots` |
| Create a game challenge | `POST /api/v1/challenges` |
| Accept/create bot game | `POST /api/v1/challenges/{id}/accept` |
| Get game state | `GET /api/v1/games/{id}` |
| Submit a move | `POST /api/v1/games/{id}/move` |
| Pass | `POST /api/v1/games/{id}/move` (move: `.`) |
| Resign | `POST /api/v1/games/{id}/resign` |

### Live events — OGS Termination Server (socket.io)

OGS uses a socket.io server for real-time game events:

- Server: `https://online-go.com` (socket.io path `/socket.io`)
- After connecting, authenticate with `{ bearer: <token> }`
- Subscribe to a game: emit `game/connect` with `{ game_id, chat: false }`
- Listen for `game/{id}/move` events — payload contains `move` (GTP coordinate or `.` for pass)
- Listen for `game/{id}/gamedata` for full game state on connect

### Coordinate notation

OGS move coordinates are encoded as a two-character string where each character is a letter `a`–`s` (for up to 19×19), with `a` = column 1 / row 1 from bottom-left. The app will translate these to standard GTP / spoken notation:

- GTP column letters: A–T (skipping I) — e.g. column 1 = A, column 9 = J (skipping I at 9)
- Rows: 1 (bottom) to N (top)
- Special: the centre of a 9×9 board (E5) may be announced as *"tengen"*

---

## Voice interface design

### Text-to-speech (TTS)

Uses `window.speechSynthesis` (Web Speech API). Announcements are queued and spoken in order.

Key announcements:
- Game started: *"Game started. You are playing Black / White."*
- Opponent move: *"Opponent plays D4"* / *"Opponent passes"*
- Your move confirmed: *"You played K10"*
- Game end: *"Game over. Black wins by 4.5 points"* / *"You resigned"*
- Errors: *"Move not recognised, please try again"*

### Speech recognition (STT)

Uses `window.SpeechRecognition` (Web Speech API). Recognition is triggered by a large "Speak your move" button (or automatically after the opponent's turn in hands-free mode).

Recognised inputs (case-insensitive):
- Board coordinates: `A1`–`T19`, spoken as letters + numbers (e.g. *"D four"*, *"Q sixteen"*)
- Named moves: `tengen`, `star point` (mapped to well-known coordinates for current board size)
- Commands: `pass`, `resign`, `cancel`

Parsing strategy:
1. Normalise transcript (strip punctuation, lowercase)
2. Try regex match for `[a-hj-t]\s?\d{1,2}` (GTP coordinate, skipping I)
3. Try named-move lookup table
4. Try command keywords
5. If unrecognised, announce error and re-prompt

---

## Application state

```
AppState {
  auth: { accessToken, userId, username } | null
  game: {
    id,
    botName,
    boardSize,       // 9 | 13 | 19
    playerColor,     // 'black' | 'white'
    moves: [],       // ordered list of played moves
    phase,           // 'playing' | 'scoring' | 'finished'
    result           // null | string
  } | null
  ui: {
    listeningForMove: boolean
    boardVisible: boolean     // text board toggle
    graphicalBoardVisible: boolean
  }
}
```

State is kept in memory during the session. Active game ID is persisted to `localStorage` so the app can reconnect after a page reload.

---

## PWA shell architecture

### Entry point

- `docs/index.html` — semantic HTML app shell with ARIA landmarks

### Manifest

- `docs/manifest.json` — standalone display, name "Zatoichi", icons

### Offline strategy

- `docs/sw.js` — cache-first for app shell assets
- Game socket connections require network; the app shows a clear offline notice

### File layout

```
docs/
  index.html
  manifest.json
  sw.js
  icons/
    icon-192.svg
    icon-512.svg
  js/
    app.js          — top-level init, state, event wiring
    auth.js         — OGS OAuth flow
    ogs.js          — REST API + socket.io client
    voice.js        — TTS + STT wrappers
    coords.js       — coordinate conversion utilities
    board.js        — optional text/graphical board rendering
```

---

## Screens / views

The app has a single-page layout with four main views, navigated by a tab bar (accessible via TalkBack swipe):

| View | Description |
|---|---|
| **Login** | Shown when unauthenticated. "Log in with OGS" button. |
| **Lobby** | Start a new game. Bot selector, board size (initial: 9×9 only). |
| **Game** | Active game. Large "Speak your move" button, move history list, optional board. |
| **Result** | Game over summary. Score, winner, option to start a new game. |

---

## Coordinate conversion reference

| OGS encoding | GTP | Spoken |
|---|---|---|
| `aa` | A1 | "A one" |
| `da` | D1 | "D one" |
| `dd` | D4 | "D four" |
| `ee` | E5 | "tengen" (9×9 centre) |
| `.` | pass | "passes" |

OGS skips the letter `i` in GTP notation (standard). The `coords.js` module handles all conversions.
