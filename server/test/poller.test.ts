import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../src/library.js';
import { UpstreamClient } from '../src/upstream.js';
import { Poller } from '../src/poller.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';
import type { Track } from '../src/types.js';

let fake: FakeUpstream | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

async function setup(opts: Parameters<typeof startFakeUpstream>[0] = {}) {
  fake = await startFakeUpstream(opts);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poller-'));
  const lib = new Library(path.join(dir, 'library.json'));
  await lib.load();
  const upstream = new UpstreamClient(fake.url);
  const poller = new Poller(lib, upstream, path.join(dir, 'tracks'), 1000, () => {});
  return { dir, lib, upstream, poller };
}

const track = (jobId: string, format = 'flac'): Track => ({
  id: 't1', groupId: 'g', takeIndex: 0, jobId, title: 'T', prompt: 'p', lyrics: '[Instrumental]', duration: 30,
  seed: null, steps: null, format, status: 'queued', progress: 0, stage: 'queued', eta: null, error: null,
  file: null, createdAt: new Date().toISOString(), finishedAt: null,
});

describe('Poller', () => {
  it('walks queued → running → done and downloads the file', async () => {
    const { dir, lib, upstream, poller } = await setup();
    const { job_id } = await upstream.generate({ prompt: 'p', lyrics: '[Instrumental]', duration: 30, seed: null, steps: null, format: 'flac' });
    await lib.add(track(job_id));
    await poller.tick(); // queued
    expect(lib.get('t1')?.status).toBe('queued');
    await poller.tick(); // running 0.1
    expect(lib.get('t1')).toMatchObject({ status: 'running', progress: 0.1, stage: 'generating audio tokens', seed: 424242 });
    await poller.tick(); await poller.tick(); // 0.5, 0.95
    await poller.tick(); // done → download
    const t = lib.get('t1')!;
    expect(t.status).toBe('done');
    expect(t.file).toBe('t1.flac');
    expect(t.sampleRate).toBe(44100);
    expect(t.peakDbfs).toBe(-1.2);
    const bytes = await fs.readFile(path.join(dir, 'tracks', 't1.flac'));
    expect(bytes.toString()).toBe('RIFF-fake-audio');
    await poller.tick(); // no-op once done
    expect(fake!.requests.filter((r) => r.path.endsWith('/audio')).length).toBe(1);
  });

  it('records upstream error', async () => {
    const { lib, upstream, poller } = await setup({
      script: (id) => [{ job_id: id, status: 'error', error: 'CUDA OOM' }],
    });
    const { job_id } = await upstream.generate({ prompt: 'p', lyrics: '[Instrumental]', duration: 30, seed: null, steps: null, format: 'wav' });
    await lib.add(track(job_id, 'wav'));
    await poller.tick();
    expect(lib.get('t1')).toMatchObject({ status: 'error', error: 'CUDA OOM' });
  });

  it('marks vanished jobs as error and survives unreachable upstream', async () => {
    const { lib, poller } = await setup();
    await lib.add(track('nope'));
    await poller.tick();
    expect(lib.get('t1')?.status).toBe('error');
    await lib.update('t1', { status: 'queued', error: null });
    await fake!.close();
    fake = null;
    await poller.tick();
    expect(lib.get('t1')?.status).toBe('queued');
    expect(poller.upstreamReachable).toBe(false);
  });
});
