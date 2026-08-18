import fs from 'node:fs';
import { startFakeUpstream } from './fakeUpstream.js';

// Standalone fake for `npm run dev:fake`: jobs advance one state every ~2.5 s.
// FAKE_AUDIO=path/to/file.wav makes it serve a real, playable file.
process.env.FAKE_PORT ??= '7999';
const audioBytes = process.env.FAKE_AUDIO ? fs.readFileSync(process.env.FAKE_AUDIO) : undefined;
const fake = await startFakeUpstream({ autoAdvanceMs: Number(process.env.FAKE_ADVANCE_MS ?? 2500), audioBytes });
console.log(`fake upstream listening on ${fake.url}${audioBytes ? ` (audio: ${process.env.FAKE_AUDIO})` : ''}`);
