import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, Library } from '../src/library.js';
import type { Template, Track } from '../src/types.js';
import { RenderQueue, UpstreamClient } from '../src/upstream.js';
import { createApp } from '../src/app.js';
import { SettingsStore } from '../src/settings.js';

const seedTrack = (id: string, file: string): Track => ({
  id, groupId: id, takeIndex: 0, title: `Seed ${id}`, prompt: 'seed', lyrics: '[Instrumental]', duration: 10, seed: 1, format: 'wav',
  status: 'done', progress: 1, stage: 'done', eta: null, elapsed: 30, stream: false, renderedSeconds: null, error: null, file,
  createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:30.000Z',
});

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-'));
  const tracksDir = path.join(dir, 'tracks');
  await fs.mkdir(tracksDir);
  await fs.writeFile(path.join(tracksDir, 'a.wav'), Buffer.from('RIFFxxxxWAVEseed-a'));
  const lib = new Library(path.join(dir, 'library.json'));
  await lib.load();
  await lib.add(seedTrack('s1', 'a.wav'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'), { musicApi: null, apiKey: null });
  await settings.load();
  const upstream = new UpstreamClient('http://127.0.0.1:1');
  const templates = new JsonStore<Template>(path.join(dir, 'templates.json'));
  await templates.load();
  const queue = new RenderQueue(lib, upstream, tracksDir, () => {}, 20);
  const app = createApp({ library: lib, templates, settings, upstream, queue, tracksDir, log: () => {}, demo: { renderMs: 120, tickMs: 20 } });
  return { app, lib };
}

const until = async (cond: () => Promise<boolean>, ms = 4000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
};

describe('demo mode', () => {
  it('reports demo health without touching any upstream', async () => {
    const { app } = await setup();
    const h = await request(app).get('/api/health');
    expect(h.body).toMatchObject({ demo: true, upstreamReachable: true, ready: true, capabilities: [] });
  });

  it('refuses writes to seed tracks, settings and templates', async () => {
    const { app, lib } = await setup();
    expect((await request(app).delete('/api/tracks/s1')).status).toBe(403);
    expect(lib.get('s1')).toBeDefined();
    expect((await request(app).put('/api/settings').send({ musicApi: 'http://x:1' })).status).toBe(403);
    expect((await request(app).post('/api/settings/test').send({})).status).toBe(403);
    expect((await request(app).post('/api/templates').send({ name: 'n', prompt: 'p' })).status).toBe(403);
    expect((await request(app).delete('/api/templates/x')).status).toBe(403);
  });

  it('simulates a render per visitor and hands out a seed file as the result', async () => {
    const { app, lib } = await setup();
    const agent = request.agent(app);
    const other = request.agent(app);
    const res = await agent.post('/api/generate').send({ prompt: 'lofi', duration: 30, takes: 2, seed: 9 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ status: 'queued', seed: 9 });
    const id = res.body[0].id as string;
    // visible to this visitor, invisible to another, never persisted
    expect((await agent.get('/api/library')).body.map((t: Track) => t.id)).toEqual([res.body[1].id, id, 's1']);
    expect((await other.get('/api/library')).body.map((t: Track) => t.id)).toEqual(['s1']);
    expect(lib.all().map((t) => t.id)).toEqual(['s1']);
    // progresses then finishes with the seed audio
    await until(async () => (await agent.get('/api/library')).body.find((t: Track) => t.id === id)?.status === 'running');
    await until(async () => (await agent.get('/api/library')).body.find((t: Track) => t.id === id)?.status === 'done');
    const done = (await agent.get('/api/library')).body.find((t: Track) => t.id === id) as Track;
    expect(done.progress).toBe(1);
    expect(done.file).toBe('a.wav');
    expect(done.finishedAt).toBeTruthy();
    const audio = await agent.get(`/api/tracks/${id}/audio?download`);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-disposition']).toContain('.wav');
    expect(audio.body.toString()).toBe('RIFFxxxxWAVEseed-a');
    // other visitors cannot see or fetch it
    expect((await other.get(`/api/tracks/${id}/audio`)).status).toBe(404);
    // the visitor can delete their own simulated track
    expect((await agent.delete(`/api/tracks/${id}`)).status).toBe(200);
    expect((await agent.get('/api/library')).body.map((t: Track) => t.id)).toEqual([res.body[1].id, 's1']);
  });

  it('cancelling a queued simulated track removes it', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const res = await agent.post('/api/generate').send({ prompt: 'x', duration: 60, takes: 2 });
    const second = res.body[1].id as string;
    expect((await agent.delete(`/api/tracks/${second}`)).status).toBe(200);
    expect((await agent.get('/api/library')).body.map((t: Track) => t.id)).toEqual([res.body[0].id, 's1']);
  });
});
