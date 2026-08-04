# Zatoichi — Development Plan

## Phase 1 — PWA Scaffold

**Goal:** Installable app shell. No OGS connection yet.

### Deliverables

- `docs/index.html` — app shell with four view sections (login, lobby, game, result), ARIA landmarks, tab navigation
- `docs/manifest.json` — PWA manifest: name, icons, standalone display
- `docs/sw.js` — service worker, cache-first shell caching
- `docs/icons/icon-192.svg` — placeholder icon
- `docs/icons/icon-512.svg` — placeholder icon
- `docs/js/app.js` — stub: view switching, basic state object
- `docs/js/voice.js` — TTS wrapper (`speak(text)`), STT wrapper (`listenForMove()`) with browser support check
- `docs/js/coords.js` — coordinate conversion: OGS ↔ GTP ↔ spoken string

### Acceptance criteria

- App installs as PWA on Android/iOS
- TalkBack / VoiceOver can navigate all four views
- `speak("Hello")` works in browser console
- `coordToSpoken("dd")` returns `"D four"`

---

## Phase 2 — OGS Authentication

**Goal:** Log in to OGS with OAuth and display the user's name.

### Deliverables

- `docs/js/auth.js` — OAuth 2.0 PKCE flow against OGS
  - `login()` — redirect to OGS authorization page
  - `handleCallback()` — exchange code for token, store in `localStorage`
  - `logout()` — clear token, return to login view
  - `getToken()` — return stored token or null
- Login view wired up: "Log in with OGS" button triggers `login()`
- After login, fetch `/api/v1/me`, announce username via TTS, show lobby view

### Acceptance criteria

- Full OAuth round-trip works on localhost and GitHub Pages
- Username announced after login
- Token survives page reload; user is not asked to log in again
- Logout button works

---

## Phase 3 — Create a Bot Game

**Goal:** Create a 9×9 game against an OGS bot and receive game ID.

### Deliverables

- `docs/js/ogs.js` — REST client
  - `fetchBots()` — returns list of available bots
  - `createBotChallenge(botId, options)` — posts challenge and returns `game_id`
- Lobby view: bot name displayed, "Start Game" button
- On success: announce *"Game started. You are playing Black."*, switch to game view

### Acceptance criteria

- A real game is created on OGS against a bot
- Player colour is correctly identified and announced
- Game ID stored in `localStorage` for reconnect

---

## Phase 4 — Live Game: Receive Moves

**Goal:** Connect to the OGS socket and announce opponent moves via TTS.

### Deliverables

- `docs/js/ogs.js` — socket.io client (loaded from CDN)
  - `connectToGame(gameId, onMove, onGameOver)` — subscribe to live events
  - Handles `game/{id}/move` events
  - Handles `game/{id}/gamedata` for reconnect (replays existing moves silently, announces last opponent move)
- Game view: scrollable move history list (ARIA live region), updated on each move
- TTS announcement on each incoming move

### Acceptance criteria

- Opponent moves announced in real time
- After page reload, app reconnects to the in-progress game
- Move history list is navigable by TalkBack

---

## Phase 5 — Live Game: Submit Moves via Voice

**Goal:** Accept spoken moves and submit them to OGS.

### Deliverables

- Game view: large "Speak your move" button (ARIA label: *"Speak your move. Tap to activate."*)
- `voice.js` `listenForMove()` — activates STT, returns parsed coordinate or command
- `ogs.js` `submitMove(gameId, ogsCoord)` — POST to OGS move endpoint
- `ogs.js` `pass(gameId)` — submit pass
- `ogs.js` `resign(gameId)` — submit resign
- Move parsing with error announcement and re-prompt on failure

### Acceptance criteria

- Can play a complete 9×9 game against a bot using only voice
- Pass and resign work verbally
- Invalid input results in a spoken error and re-prompt (not a silent failure)
- Move announced back after submission: *"You played D four"*

---

## Phase 6 — Game Over & Result

**Goal:** Detect game end, announce result, return to lobby.

### Deliverables

- Handle `game/{id}/gamedata` or socket event with `phase: 'finished'`
- Announce result: *"Game over. Black wins by 4.5 points."* / *"White wins by resignation."*
- Result view shown with score summary
- "New game" button returns to lobby

### Acceptance criteria

- Result correctly announced for score, resignation, and timeout
- App returns to a clean lobby state after result is acknowledged

---

## Phase 7 — Additional Game Options (v2)

**Goal:** Support full range of game creation options.

### Deliverables

- Board size selector: 9×9, 13×13, 19×19
- Time setting selector: absolute, byo-yomi, Fischer (with presets)
- Ranked / casual toggle
- Play against a human: create an open challenge or challenge a specific user by name
- All new options accessible via TalkBack

---

## Phase 8 — Optional Board Display (v2)

**Goal:** Optional text and graphical board for sighted or low-vision users.

### Deliverables

- `docs/js/board.js`
  - `renderTextBoard(moves, size)` — returns a `<pre>` string with coordinate labels
  - `renderCanvas(moves, size, canvasEl)` — draws a basic graphical board
- Text board toggle button in game view (hidden by default)
- Graphical board toggle button (hidden by default)
- Both are purely supplementary; removing them does not affect voice gameplay

---

## Milestones summary

| Phase | Feature | Status |
|---|---|---|
| 1 | PWA scaffold + voice stubs + coord utils | ✅ complete |
| 2 | OGS OAuth login | ✅ complete |
| 3 | Create bot game | ⬜ not started |
| 4 | Receive & announce live moves | ⬜ not started |
| 5 | Submit moves by voice | ⬜ not started |
| 6 | Game over & result | ⬜ not started |
| 7 | Full game options | ⬜ not started |
| 8 | Optional board display | ⬜ not started |
