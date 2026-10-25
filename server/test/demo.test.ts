import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, Library } from '../src/library.js';
import type { Template, Track } from '../src/types.js';
import { RenderQueue, UpstreamClient } from '../src/upstream.js';
import { createApp } from '../src/app.js';
import { DEFAULT_MUSIC_API, SettingsStore, type EnvOverrides } from '../src/settings.js';
import { SkillFiles } from '../src/enhance.js';
import type { DemoOptions } from '../src/demo.js';

const seedTrack = (id: string, file: string): Track => ({
  id, groupId: id, takeIndex: 0, title: `Seed ${id}`, prompt: 'seed', lyrics: '[Instrumental]', duration: 10, seed: 1, format: 'wav',
  status: 'done', progress: 1, stage: 'done', eta: null, elapsed: 30, stream: false, renderedSeconds: null, error: null, file,
  createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:30.000Z',
});

async function setup(demo: DemoOptions = { renderMs: 120, tickMs: 20 }, env: EnvOverrides = { musicApi: null, apiKey: null }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-'));
  const tracksDir = path.join(dir, 'tracks');
  await fs.mkdir(tracksDir);
  await fs.writeFile(path.join(tracksDir, 'a.wav'), Buffer.from('RIFFxxxxWAVEseed-a'));
  const lib = new Library(path.join(dir, 'library.json'));
  await lib.load();
  await lib.add(seedTrack('s1', 'a.wav'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'), env);
  await settings.load();
  const upstream = new UpstreamClient('http://127.0.0.1:1');
  const templates = new JsonStore<Template>(path.join(dir, 'templates.json'));
  await templates.load();
  const queue = new RenderQueue(lib, upstream, tracksDir, () => {}, 20);
  const app = createApp({ library: lib, templates, settings, upstream, queue, tracksDir, skill: new SkillFiles(path.join(dir, 'skill-cache'), 'http://127.0.0.1:1'), log: () => {}, demo });
  return { app, lib };
}

afterEach(() => vi.restoreAllMocks());

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

  it('serves read-only showcase requests without creating sessions or cookies', async () => {
    const { app } = await setup();
    const health = await request(app).get('/api/health');
    const library = await request(app).get('/api/library');
    const audio = await request(app).get('/api/tracks/s1/audio');

    expect(health.status).toBe(200);
    expect(library.body.map((t: Track) => t.id)).toEqual(['s1']);
    expect(audio.status).toBe(200);
    expect(audio.body.toString()).toBe('RIFFxxxxWAVEseed-a');
    for (const response of [health, library, audio]) expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('does not adopt unknown client session ids when generating', async () => {
    const { app } = await setup();
    const attackerSid = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const generated = await request(app).post('/api/generate').set('Cookie', `demo_sid=${attackerSid}`).send({ prompt: 'fresh session' });
    const cookie = generated.headers['set-cookie']?.[0] as string | undefined;
    const freshSid = /demo_sid=([^;]+)/.exec(cookie ?? '')?.[1];

    expect(generated.status).toBe(201);
    expect(freshSid).toBeTruthy();
    expect(freshSid).not.toBe(attackerSid);
    const unknownRead = await request(app).get('/api/library').set('Cookie', `demo_sid=${attackerSid}`);
    expect(unknownRead.body.map((t: Track) => t.id)).toEqual(['s1']);
    expect(unknownRead.headers['set-cookie']).toBeUndefined();
    await request(app).delete(`/api/tracks/${generated.body[0].id}`).set('Cookie', `demo_sid=${freshSid}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it('returns a canned settings view with all settings locked', async () => {
    const { app } = await setup({ renderMs: 120, tickMs: 20 }, {
      musicApi: 'https://private.example/music', apiKey: 'host-music-secret',
      llmApi: 'https://private.example/llm', llmApiKey: 'host-llm-secret', llmModel: 'host-model',
    });
    const response = await request(app).get('/api/settings');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      musicApi: DEFAULT_MUSIC_API, apiKeySet: false, compat: false,
      llmApi: null, llmModel: null, llmKeySet: false,
      source: { musicApi: 'default', apiKey: 'none', llmApi: 'none', llmApiKey: 'none', llmModel: 'none' },
      locked: { musicApi: true, apiKey: true, llmApi: true, llmApiKey: true, llmModel: true },
    });
    expect(Object.values(response.body.locked).every(Boolean)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('private.example');
    expect(JSON.stringify(response.body)).not.toContain('host-music-secret');
    expect(JSON.stringify(response.body)).not.toContain('host-llm-secret');
    expect(JSON.stringify(response.body)).not.toContain('host-model');
  });

  it('blocks API routes outside the demo allowlist by default', async () => {
    const { app } = await setup();
    for (const response of [
      await request(app).get('/api/templates'),
      await request(app).get('/api/future-secret'),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'This is a read-only demo — changes are not saved.' });
    }
  });

  it('evicts the least recently used session and stops its active timer', async () => {
    const { app } = await setup({ renderMs: 5000, tickMs: 10, maxSessions: 2 });
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const oldest = request.agent(app);
    const lru = request.agent(app);
    const replacement = request.agent(app);
    const oldestTrack = (await oldest.post('/api/generate').send({ prompt: 'oldest' })).body[0] as Track;
    const lruTrack = (await lru.post('/api/generate').send({ prompt: 'least recently used' })).body[0] as Track;
    await until(async () => (await lru.get('/api/library')).body.find((t: Track) => t.id === lruTrack.id)?.status === 'running');
    await oldest.get('/api/library');
    expect(clearInterval).not.toHaveBeenCalled();

    const replacementTrack = (await replacement.post('/api/generate').send({ prompt: 'replacement' })).body[0] as Track;
    expect((await oldest.get('/api/library')).body.map((t: Track) => t.id)).toContain(oldestTrack.id);
    const evicted = await lru.get('/api/library');
    expect(evicted.body.map((t: Track) => t.id)).toEqual(['s1']);
    expect(evicted.headers['set-cookie']).toBeUndefined();
    expect(clearInterval).toHaveBeenCalled();

    await oldest.delete(`/api/tracks/${oldestTrack.id}`);
    await replacement.delete(`/api/tracks/${replacementTrack.id}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it('refuses writes to seed tracks, settings and templates', async () => {
    const { app, lib } = await setup();
    expect((await request(app).delete('/api/tracks/s1')).status).toBe(403);
    expect(lib.get('s1')).toBeDefined();
    expect((await request(app).put('/api/settings').send({ musicApi: 'http://x:1' })).status).toBe(403);
    expect((await request(app).post('/api/enhance').send({ prompt: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/lyrics').send({ prompt: 'x' })).status).toBe(403);
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
