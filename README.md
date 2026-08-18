# minimax-music-ui

Suno-style local web UI for a self-hosted [MiniMax-Music3](https://huggingface.co/MiniMaxAI/MiniMax-Music3) inference server.

- **web/** — Vite + React + Tailwind SPA (create form, take queue with live progress, library, waveform player)
- **server/** — Express 5 server that proxies generation to the inference box, polls jobs, downloads finished audio into `data/tracks/` and keeps metadata in `data/library.json`. Serves the built SPA.

## Run

```bash
npm install
npm run build
MUSIC_API=http://100.105.185.107:7862 npm start        # → http://localhost:8787
```

Env vars (server):

| Var | Default | Notes |
|---|---|---|
| `MUSIC_API` | `http://127.0.0.1:7862` | inference server base URL |
| `MUSIC_API_KEY` | – | sent as `Authorization: Bearer` if the server was started with `--api-key` |
| `PORT` | `8787` | UI server port |
| `DATA_DIR` | `./data` | library JSON + audio files |
| `STATIC_DIR` | `web/dist` if present | built SPA to serve |

## Develop

```bash
npm run dev          # server :8787 (tsx watch) + vite :5173 with /api proxy
npm run dev:fake     # same, plus a fake inference API on :7999 (no GPU needed)
npm test             # server unit/integration tests (vitest)
npm run typecheck
```

`FAKE_AUDIO=/path/to/file.wav FAKE_ADVANCE_MS=1500 npm run fake -w server` makes the fake serve a real, playable file and progress faster.

## UI server API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | upstream `/health` + `upstreamReachable` |
| GET | `/api/library` | tracks, newest first |
| POST | `/api/generate` | `{title?, prompt, lyrics?, duration, seed?, steps?, format, takes}` → created tracks (one per take; `seed+i` per take when a seed is given) |
| GET | `/api/tracks/:id/audio` | stream audio (`?download` for attachment) |
| DELETE | `/api/tracks/:id` | cancel upstream if queued/running, delete file + entry |
| GET | `/api/templates` | saved templates (`data/templates.json`) |
| POST | `/api/templates` | `{name, prompt, lyrics?, duration?, steps?, format?}` — same name overwrites |
| DELETE | `/api/templates/:id` | remove a template |
