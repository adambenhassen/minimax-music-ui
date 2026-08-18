<p align="center">
  <img src="docs/assets/banner.svg" alt="MiniMax Music UI" width="100%">
</p>

<p align="center">
  A Suno-style web interface for a self-hosted <a href="https://huggingface.co/MiniMaxAI/MiniMax-Music3">MiniMax-Music3</a> inference server.<br>
  Write a style prompt and lyrics, queue takes, watch them render, and keep a local library with a waveform player.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-ff5c8a.svg"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/react-19-149eca?logo=react&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/vite-8-646cff?logo=vite&logoColor=white">
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/tailwind-4-06b6d4?logo=tailwindcss&logoColor=white">
</p>

<p align="center">
  <img src="docs/assets/screenshot.png" alt="MiniMax Music UI — create panel, track feed and player" width="100%">
</p>

## Features

- **Create panel** — Simple or Custom mode, song title, style description, lyrics editor with `[Verse]` / `[Chorus]` / … tag chips, instrumental toggle, duration 5–360 s, 1–4 takes per submit (each take gets `seed + i`), advanced seed / steps / output format.
- **Templates** — a built-in default plus your own saved templates (style, lyrics, duration, steps, format), stored server-side.
- **Live queue** — cards show stage, progress bar and ETA straight from the inference server; cancel while queued, retry on error.
- **Library** — every finished render is downloaded into `data/tracks/` with its metadata (prompt, lyrics, seed, peak level…) so it survives the inference box pruning its own job list. Search, download, delete, "reuse settings".
- **Player** — sticky bottom bar with waveform (decoded client-side), seek, prev/next, keyboard space to play/pause.
- **Health pill** — offline / loading model / idle / rendering · N queued.
- Responsive down to phone width. No external services; everything runs on your machine or tailnet.

## Architecture

```
browser ──/api/*──▶ server/ (Express 5)  ──HTTP──▶  MiniMax-Music3 inference server (:7862)
                      │  polls /jobs/{id} every 1 s
                      │  downloads /jobs/{id}/audio when done
                      └─▶ data/library.json · data/templates.json · data/tracks/*.flac|wav|mp3
```

| Package | What |
|---|---|
| `web/` | Vite + React 19 + TypeScript + Tailwind 4 single-page app. Talks only to `/api/*`. |
| `server/` | Express 5 + TypeScript. Owns the library, proxies generation, serves the built SPA. |

## Requirements

- Node.js 20 or newer
- A running MiniMax-Music3 inference server exposing `POST /generate`, `GET /jobs/{id}`, `GET /jobs/{id}/audio`, `DELETE /jobs/{id}`, `GET /health` (see [Upstream API](#upstream-api))

## Quick start

```bash
git clone https://github.com/adambenhassen/minimax-music-ui.git
cd minimax-music-ui
npm install
npm run build
MUSIC_API=http://<inference-host>:7862 npm start
# → http://localhost:8787
```

### Configuration

All configuration is via environment variables on the server process.

| Variable | Default | Description |
|---|---|---|
| `MUSIC_API` | `http://127.0.0.1:7862` | Base URL of the inference server |
| `MUSIC_API_KEY` | – | Sent as `Authorization: Bearer …` if the inference server was started with `--api-key` |
| `PORT` | `8787` | Port for the UI server |
| `DATA_DIR` | `./data` | Where `library.json`, `templates.json` and `tracks/` live |
| `STATIC_DIR` | `web/dist` (if built) | Directory of the built SPA to serve |

## Development

```bash
npm run dev          # server on :8787 (tsx watch) + Vite on :5173 with /api proxied
npm run dev:fake     # same, plus a fake inference API on :7999 — no GPU needed
npm test             # server tests (vitest) against the fake upstream
npm run typecheck    # both packages
```

The fake upstream (`server/test/fakeUpstream.ts`) walks each job through `queued → running → done`. Options for the standalone runner:

```bash
FAKE_AUDIO=/path/to/real.wav FAKE_ADVANCE_MS=1500 npm run fake -w server
```

## UI server API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Upstream `/health` plus `upstreamReachable` |
| `GET` | `/api/library` | Tracks, newest first |
| `POST` | `/api/generate` | `{title?, prompt, lyrics?, duration, seed?, steps?, format, takes}` → created tracks |
| `GET` | `/api/tracks/:id/audio` | Stream audio (`?download` for an attachment) |
| `DELETE` | `/api/tracks/:id` | Cancel upstream if in flight, delete file and entry |
| `GET` | `/api/templates` | Saved templates |
| `POST` | `/api/templates` | `{name, prompt, lyrics?, duration?, steps?, format?}` — same name overwrites |
| `DELETE` | `/api/templates/:id` | Remove a template |

## Upstream API

The server expects the inference box to speak this contract:

| Method | Path | |
|---|---|---|
| `POST` | `/generate` | `{prompt, lyrics="[Instrumental]", duration=60 (5–360), seed?, steps? (10–100), format="wav"\|wav16\|wav32f\|flac\|mp3, wait=false}` → `{job_id}` |
| `GET` | `/jobs/{id}` | `{status: queued\|running\|done\|error, progress, stage, eta, seed, error?, audio_url?, sampling_rate?, peak_dbfs?, clipped?}` |
| `GET` | `/jobs/{id}/audio` | Finished render |
| `DELETE` | `/jobs/{id}` | Cancel if queued / delete file |
| `GET` | `/health` | `{ready, busy, queued, formats[], sampling_rate}` |

Only one job renders at a time upstream; additional submissions queue. Rendering is roughly 2.5–3× slower than realtime.

## Contributing

Issues and pull requests are welcome. Run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](LICENSE)
