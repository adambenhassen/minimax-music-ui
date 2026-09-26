# Changelog

## v0.1.1 — 2026-09-26

### Create
- Prompt enhancement: a magic-wand button on the prompt field rewrites the description into a structured Music 3 caption (Global Metadata / Vocal Details / Arrangement) with MiniMax's `music-caption-rewriter` skill, run on an OpenAI-compatible LLM with tool calling (Settings, or `LLM_API` / `LLM_API_KEY` / `LLM_MODEL`). Skill files are fetched on first use and cached in `data/skill-cache/`; undo restores the original text. Disabled in the demo.

### Fixes
- Renders longer than 5 minutes no longer fail with "upstream unreachable: fetch failed": the HTTP client's 300 s header/body timeouts are off for `/v1/audio/speech` (optional `UPSTREAM_TIMEOUT_MS`), and a timeout is reported as "upstream timed out after Ns".
- JSON stores recover from a failed write instead of blocking later writes, and render-progress updates no longer write snapshots to disk.
- Settings updates are all-or-nothing: a rejected field no longer leaves earlier fields half-applied.

### Maintenance
- Dependencies updated (vitest 5); fixes the moderate `qs` advisory.

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
