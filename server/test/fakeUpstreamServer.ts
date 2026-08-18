import fs from 'node:fs';
import { startFakeUpstream } from './fakeUpstream.js';

// Standalone fake for `npm run dev:fake` — no GPU needed.
// FAKE_AUDIO=path/to/file.wav serves a real, playable file; FAKE_RENDER_MS sets the blocking render time;
// FAKE_LOADING=1 exposes /health answering 503 (model still loading).
const port = Number(process.env.FAKE_PORT ?? 7999);
const audioBytes = process.env.FAKE_AUDIO ? fs.readFileSync(process.env.FAKE_AUDIO) : undefined;
const fake = await startFakeUpstream({ renderMs: Number(process.env.FAKE_RENDER_MS ?? 8000), audioBytes, port, loading: process.env.FAKE_LOADING ? true : undefined });
console.log(`fake MiniMax-Music3 server (POST /v1/audio/speech) listening on ${fake.url}${audioBytes ? ` (audio: ${process.env.FAKE_AUDIO})` : ''}`);
