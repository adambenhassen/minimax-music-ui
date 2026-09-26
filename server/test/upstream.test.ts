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

describe('UpstreamClient render timeout', () => {
  const dest = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'up-')), 'a.wav');

  it('a render slower than UPSTREAM_TIMEOUT_MS fails as a timeout, not as unreachable', async () => {
    fake = await startFakeUpstream({ renderMs: 2500 }); // undici checks timeouts on a ~1 s tick, so leave headroom
    const c = new UpstreamClient(fake.url, null, false, 200);
    await expect(c.speechToFile(body, await dest())).rejects.toThrow('upstream timed out after 0.2s waiting for the render');
  });

  it('no timeout (0): waits for a render however long it takes', async () => {
    fake = await startFakeUpstream({ renderMs: 400 });
    const c = new UpstreamClient(fake.url, null, false, 0);
    const out = await dest();
    await c.speechToFile(body, out);
    expect((await fs.readFile(out)).toString()).toBe('RIFF-fake-audio');
  });

  it('user cancel still aborts a render with no timeout', async () => {
    fake = await startFakeUpstream({ renderMs: 2000 });
    const c = new UpstreamClient(fake.url);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await expect(c.speechToFile(body, await dest(), ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
