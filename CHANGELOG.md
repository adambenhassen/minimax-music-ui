# Changelog

## v0.1.0 — 2026-08-19

First release. Live demo: https://demo-minimax-music.adambh.dev

### Create & library
- Suno-style create panel: title (random name if empty), style description, lyrics editor with section tag chips, instrumental toggle, duration 5–360 s, 1–4 takes per submit (`seed + i`), advanced seed and format (WAV; FLAC/MP3 shown disabled).
- Templates: built-in default plus saved templates, stored server-side.
- Track feed with cover, take number, duration, seed, render time ("took 5m5s") and time since finish; search over title / style / lyrics in Library.
- Track detail side panel (click a card): large cover with play, status/progress, actions, full style and lyrics, details grid.
- Sticky player with client-side waveform, seek, prev/next, keyboard play/pause.

### Rendering
- Own render queue: one track at a time against the standard blocking `POST /v1/audio/speech`; queued / rendering / done, cancel, retry, estimated progress and ETA. Queued tracks survive a UI-server restart.
- Optional live progress + play-while-rendering when the server advertises `capabilities: ["stream"]` on `/health` (SSE progress and PCM windows; growing WAV served with a live-patched header and Range support). Stock `sgl-omni` keeps the estimated bar.
- "Loading model…" state when `/health` answers 503.

### Server & ops
- Express 5 + TypeScript UI server; JSON stores for library, templates and settings; API key never returned to the browser.
- Settings page: inference server URL + optional API key with "Test connection"; `MUSIC_API` / `MUSIC_API_KEY` env override and lock the fields; compatibility mode switch (treat any server as stock `sgl-omni`).
- Bundled single-GPU inference server (`inference/server.py`) exposing the same API as `sgl-omni serve`, plus the streaming extension.
- Read-only demo mode (`DEMO=1`, `Dockerfile.demo`): showcase library, simulated per-visitor renders, writes refused.
- Docker image (`ghcr.io/adambenhassen/minimax-music-ui`, amd64 + arm64), docker-compose, CI (tests, typecheck, build) and release workflow.
