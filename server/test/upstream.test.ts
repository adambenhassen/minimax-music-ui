import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UpstreamClient, type StreamEvent } from '../src/upstream.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';

let fake: FakeUpstream | null = null;
afterEach(async () => { await fake?.close(); fake = null; });
const body = { prompt: 'p', lyrics: 'l', duration: 2, seed: 7, format: 'wav' };

describe('UpstreamClient streaming', () => {
  it('health reports capabilities; canStream false for stock servers', async () => {
    fake = await startFakeUpstream({ modelId: null });
    const c = new UpstreamClient(fake.url);
    expect((await c.health()).capabilities).toEqual([]);
    expect(c.canStream).toBe(false);
  });
  it('speechStream writes a valid WAV incrementally and reports events', async () => {
    fake = await startFakeUpstream({ stream: { windows: 3, secondsPerWindow: 0.1 } });
    const c = new UpstreamClient(fake.url);
    expect((await c.health()).capabilities).toEqual(['stream']);
    expect(c.canStream).toBe(true);
    const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'up-')), 'a.wav');
    const events: StreamEvent[] = [];
    const { seed } = await c.speechStream(body, dest, (e) => events.push(e));
    expect(seed).toBe(7);
    expect(events.filter((e) => e.type === 'audio').map((e) => (e as { secondsRendered: number }).secondsRendered.toFixed(1))).toEqual(['0.1', '0.2', '0.3']);
    expect(events.some((e) => e.type === 'progress' && e.stage === 'semantic')).toBe(true);
    expect(events.some((e) => e.type === 'progress' && e.stage === 'denoise')).toBe(true);
    const wav = await fs.readFile(dest);
    const data = Math.round(0.1 * 44100) * 4 * 3;
    expect(wav.length).toBe(44 + data);
    expect(wav.readUInt32LE(40)).toBe(data);
    expect(wav.readUInt32LE(4)).toBe(36 + data);
    expect(fake.requests.at(-1)?.body).toMatchObject({ stream: true });
  });
  it('rejects when the server answers non-SSE to stream:true', async () => {
    fake = await startFakeUpstream({});
    const c = new UpstreamClient(fake.url);
    await expect(c.speechStream(body, path.join(os.tmpdir(), 'x.wav'), () => {})).rejects.toThrow(/400/);
  });
});
