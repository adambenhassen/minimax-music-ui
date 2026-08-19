import fs from 'node:fs';
import { startFakeUpstream } from './fakeUpstream.js';

// Standalone fake for `npm run dev:fake` — no GPU needed.
// FAKE_AUDIO=path/to/file.wav serves a real, playable file; FAKE_RENDER_MS sets the blocking render time;
// FAKE_LOADING=1 exposes /health answering 503 (model still loading).
// FAKE_STREAM=1 advertises streaming and answers stream:true with SSE progress + 4 s PCM windows.
const port = Number(process.env.FAKE_PORT ?? 7999);
const audioBytes = process.env.FAKE_AUDIO ? fs.readFileSync(process.env.FAKE_AUDIO) : undefined;
const fake = await startFakeUpstream({ renderMs: Number(process.env.FAKE_RENDER_MS ?? 8000), audioBytes, port, loading: process.env.FAKE_LOADING ? true : undefined,
  stream: process.env.FAKE_STREAM ? { windows: 6, windowMs: Number(process.env.FAKE_RENDER_MS ?? 8000) / 8, secondsPerWindow: 4 } : undefined });
console.log(`fake MiniMax-Music3 server (POST /v1/audio/speech) listening on ${fake.url}${audioBytes ? ` (audio: ${process.env.FAKE_AUDIO})` : ''}`);
