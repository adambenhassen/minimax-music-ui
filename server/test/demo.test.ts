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
import { SkillFiles } from '../src/enhance.js';

const seedTrack = (id: string, file: string): Track => ({
  id, groupId: id, takeIndex: 0, title: `Seed ${id}`, prompt: 'seed', lyrics: '[Instrumental]', duration: 10, seed: 1, format: 'wav',
  status: 'done', progress: 1, stage: 'done', eta: null, elapsed: 30, stream: false, renderedSeconds: null, error: null, file,
  createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:30.000Z',
});

async function setup(uiToken: string | null = null) {
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
  const previousUiToken = process.env.UI_TOKEN;
  if (uiToken === null) delete process.env.UI_TOKEN;
  else process.env.UI_TOKEN = uiToken;
  const app = createApp({ library: lib, templates, settings, upstream, queue, tracksDir, skill: new SkillFiles(path.join(dir, 'skill-cache'), 'http://127.0.0.1:1'), log: () => {}, demo: { renderMs: 120, tickMs: 20 } });
  if (previousUiToken === undefined) delete process.env.UI_TOKEN;
  else process.env.UI_TOKEN = previousUiToken;
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
    expect(h.body).toMatchObject({ demo: true, upstreamReachable: true, ready: true, capabilities: [], enhance: false });
  });

  it('requires UI_TOKEN for demo API reads while leaving ping public', async () => {
    const { app } = await setup('test-ui-token');
    expect((await request(app).get('/api/health')).status).toBe(401);
    const health = await request(app).get('/api/health').set('Authorization', 'Bearer test-ui-token');
    expect(health.status).toBe(200);
    expect(health.body.demo).toBe(true);
    expect((await request(app).get('/api/ping')).status).toBe(200);
  });

  it('refuses writes to seed tracks, settings and templates', async () => {
    const { app, lib } = await setup();
    expect((await request(app).delete('/api/tracks/s1').set('X-Requested-With', 'XMLHttpRequest')).status).toBe(403);
    expect(lib.get('s1')).toBeDefined();
    expect((await request(app).put('/api/settings').set('X-Requested-With', 'XMLHttpRequest').send({ musicApi: 'http://x:1' })).status).toBe(403);
    expect((await request(app).post('/api/enhance').set('X-Requested-With', 'XMLHttpRequest').send({ prompt: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/lyrics').set('X-Requested-With', 'XMLHttpRequest').send({ prompt: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/settings/test').set('X-Requested-With', 'XMLHttpRequest').send({})).status).toBe(403);
    expect((await request(app).post('/api/templates').set('X-Requested-With', 'XMLHttpRequest').send({ name: 'n', prompt: 'p' })).status).toBe(403);
    expect((await request(app).delete('/api/templates/x').set('X-Requested-With', 'XMLHttpRequest')).status).toBe(403);
  });

  it('simulates a render per visitor and hands out a seed file as the result', async () => {
    const { app, lib } = await setup();
    const agent = request.agent(app);
    const other = request.agent(app);
    const res = await agent.post('/api/generate').set('X-Requested-With', 'XMLHttpRequest').send({ prompt: 'lofi', duration: 30, takes: 2, seed: 9 });
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
    expect((await agent.delete(`/api/tracks/${id}`).set('X-Requested-With', 'XMLHttpRequest')).status).toBe(200);
    expect((await agent.get('/api/library')).body.map((t: Track) => t.id)).toEqual([res.body[1].id, 's1']);
  });

  it('cancelling a queued simulated track removes it', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const res = await agent.post('/api/generate').set('X-Requested-With', 'XMLHttpRequest').send({ prompt: 'x', duration: 60, takes: 2 });
    const second = res.body[1].id as string;
    expect((await agent.delete(`/api/tracks/${second}`).set('X-Requested-With', 'XMLHttpRequest')).status).toBe(200);
    expect((await agent.get('/api/library')).body.map((t: Track) => t.id)).toEqual([res.body[0].id, 's1']);
  });
});
