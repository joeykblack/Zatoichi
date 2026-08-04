# Zatoichi

A PWA for playing Go on [OGS (Online-Go.com)](https://online-go.com/) using **voice only** — designed from the ground up for accessibility, screen readers, and blind or visually impaired players.

Named after Zatoichi, the legendary blind swordsman.

**Live:** https://joeykblack.github.io/Zatoichi/

---

## What it does

Zatoichi connects to your OGS account and lets you play a full game of Go without looking at a screen:

- The app **announces the opponent's move** using text-to-speech (e.g. *"Opponent plays Q16"*)
- You **speak your move** (e.g. *"D4"* or *"tengen"*) and it is submitted to OGS
- Special commands: **"pass"** and **"resign"** are recognised verbally
- All UI is accessible via screen readers (TalkBack on Android, VoiceOver on iOS)

---

## Initial features (v1)

- Log in to your OGS account via OAuth
- Create a 9×9 game against a bot
- Play a full game:
  - TTS announces opponent moves
  - Speech recognition accepts your moves, pass, and resign

## Planned features (v2+)

- Full game options: board size (9×9, 13×13, 19×19), time settings, ranked/casual
- Play against human opponents
- Optional text board display (coordinate grid in a `<pre>` block)
- Optional graphical board (canvas-based, for sighted or low-vision users)

---

## Hosting

Static PWA served from the `docs/` folder, hosted on GitHub Pages. No build step required.

## Run locally

```bash
cd docs
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## Design & planning

- [DESIGN.md](DESIGN.md) — Architecture, accessibility approach, OGS API overview
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — Phased implementation steps

## Stack

- Vanilla JavaScript — no framework, no bundler
- OGS REST API + WebSocket (socket.io) for live game events
- Web Speech API: `SpeechSynthesis` (TTS) + `SpeechRecognition` (STT)
- PWA: Service Worker + Web App Manifest
- Static hosting from `docs/` on GitHub Pages
