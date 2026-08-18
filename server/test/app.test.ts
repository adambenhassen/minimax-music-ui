import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, Library } from '../src/library.js';
import type { Template, Track } from '../src/types.js';
import { RenderQueue, UpstreamClient } from '../src/upstream.js';
import { createApp } from '../src/app.js';
import { SettingsStore } from '../src/settings.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';

let fake: FakeUpstream | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

async function setup(opts: Parameters<typeof startFakeUpstream>[0] = {}, apiKey: string | null = null, env: { musicApi: string | null; apiKey: string | null } | null = null) {
  fake = await startFakeUpstream(opts);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  const lib = new Library(path.join(dir, 'library.json'));
  await lib.load();
  const settings = new SettingsStore(path.join(dir, 'settings.json'), env ?? { musicApi: fake.url, apiKey });
  await settings.load();
  const upstream = new UpstreamClient(fake.url, apiKey);
  const tracksDir = path.join(dir, 'tracks');
  const templates = new JsonStore<Template>(path.join(dir, 'templates.json'));
  await templates.load();
  const queue = new RenderQueue(lib, upstream, tracksDir, () => {}, 20);
  const app = createApp({ library: lib, templates, settings, upstream, queue, tracksDir, log: () => {} });
  return { app, lib, tracksDir, dir, upstream, queue };
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('app', () => {
  it('health probes /v1/models and reports queue state', async () => {
    const { app } = await setup();
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ upstreamReachable: true, ready: true, busy: false, queued: 0, formats: ['wav', 'flac', 'mp3'], models: ['minimax_ttm'] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);
    await fake!.close(); fake = null;
    const down = await request(app).get('/api/health');
    expect(down.body.upstreamReachable).toBe(false);
    expect(down.body.error).toMatch(/unreachable/);
    expect(down.body.formats).toEqual(['wav', 'flac', 'mp3']);
  });

  it('generate → queue → speech → file: maps fields, serialises takes, forwards bearer', async () => {
    const { app, lib } = await setup({ renderMs: 120 }, 'sekrit');
    const res = await request(app).post('/api/generate').send({ prompt: 'ambient', lyrics: '', duration: 10, format: 'flac', takes: 2, seed: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ status: 'queued', seed: 5, lyrics: '[Instrumental]' });
    expect(res.body[1].seed).toBe(6);
    expect(res.body[0].groupId).toBe(res.body[1].groupId);
    expect(res.body[0].title).toBe(res.body[1].title);
    const [a, b] = res.body as Track[];
    await until(() => lib.get(a.id)?.status === 'running');
    expect(lib.get(b.id)?.status).toBe('queued'); // one render at a time
    await until(() => (lib.get(a.id)?.elapsed ?? 0) > 0);
    expect(lib.get(a.id)?.progress).toBeGreaterThan(0);
    expect(lib.get(a.id)?.progress).toBeLessThan(1);
    await until(() => lib.get(b.id)?.status === 'done');
    expect(lib.get(a.id)).toMatchObject({ status: 'done', file: `${a.id}.flac`, seed: 5, progress: 1, eta: 0 });
    const speech = fake!.requests.filter((r) => r.path === '/v1/audio/speech');
    expect(speech).toHaveLength(2);
    expect(speech[0].auth).toBe('Bearer sekrit');
    expect(speech[0].body).toEqual({ model: 'minimax_ttm', input: '[Instrumental]', instructions: 'ambient', response_format: 'flac', max_new_tokens: 250, stream: false, seed: 5 });
    expect(speech[1].body).toMatchObject({ seed: 6 });
    const audio = await request(app).get(`/api/tracks/${a.id}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/flac');
    expect(Buffer.from(audio.body).toString()).toBe('RIFF-fake-audio');
    const dl = await request(app).get(`/api/tracks/${a.id}/audio?download`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename=".+\.flac"$/);
  });

  it('random seed → seed reported by the server (X-Seed) is stored', async () => {
    const { app, lib } = await setup();
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.body[0].seed).toBeNull();
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(lib.get(res.body[0].id)?.seed).toBe(4242);
    expect(fake!.requests.at(-1)?.body).not.toHaveProperty('seed');
  });

  it('rejects bad input', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/generate').send({})).status).toBe(400);
    expect((await request(app).post('/api/generate').send({ prompt: 'x', format: 'wav16' })).status).toBe(400);
    expect((await request(app).post('/api/generate').send({ prompt: 'x', seed: 1.5 })).status).toBe(400);
  });

  it('records upstream failures on the track', async () => {
    const { app, lib } = await setup();
    await fake!.close(); fake = null;
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.status).toBe(201);
    await until(() => lib.get(res.body[0].id)?.status === 'error');
    expect(lib.get(res.body[0].id)?.error).toMatch(/unreachable/);
    expect(lib.get(res.body[0].id)?.file).toBeNull();
  });

  it('delete: removes queued, aborts running, deletes finished files', async () => {
    const { app, lib, queue, tracksDir } = await setup({ renderMs: 500 });
    const res = await request(app).post('/api/generate').send({ prompt: 'x', takes: 2 });
    const [a, b] = res.body as Track[];
    await until(() => lib.get(a.id)?.status === 'running');
    expect((await request(app).delete(`/api/tracks/${b.id}`)).status).toBe(200);
    expect(queue.queued).toBe(0);
    expect((await request(app).delete(`/api/tracks/${a.id}`)).status).toBe(200);
    await until(() => !queue.busy);
    await until(() => fake!.requests.some((r) => r.aborted));
    expect(lib.all()).toEqual([]);
    expect((await request(app).delete(`/api/tracks/${a.id}`)).status).toBe(404);

    const done = await request(app).post('/api/generate').send({ prompt: 'y', format: 'mp3', title: 'ambient piano' });
    const id = done.body[0].id;
    await until(() => lib.get(id)?.status === 'done');
    await fs.access(path.join(tracksDir, `${id}.mp3`));
    expect((await request(app).delete(`/api/tracks/${id}`)).status).toBe(200);
    await expect(fs.access(path.join(tracksDir, `${id}.mp3`))).rejects.toThrow();
  });

  it('failOrphans marks leftover renders after a restart', async () => {
    const { lib, queue } = await setup();
    await lib.add({ id: 'o1', groupId: 'g', takeIndex: 0, title: 'T', prompt: 'p', lyrics: '[Instrumental]', duration: 10, seed: null, format: 'wav', status: 'running', progress: 0.3, stage: 'rendering', eta: null, error: null, file: null, createdAt: new Date().toISOString(), finishedAt: null });
    expect(await queue.failOrphans()).toBe(1);
    expect(lib.get('o1')).toMatchObject({ status: 'error', error: /restart/ });
  });

  it('uses the given title when present, random otherwise', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/generate').send({ prompt: 'x', title: '  Pine Morning ' })).body[0].title).toBe('Pine Morning');
    expect((await request(app).post('/api/generate').send({ prompt: 'x' })).body[0].title).toMatch(/^[A-Z][A-Za-z&' ]+$/);
  });

  it('works with a path-prefixed upstream base URL and trailing slash', async () => {
    const { app, lib } = await setup({ prefix: '/upstream/music3' }, null, { musicApi: null, apiKey: null });
    const put = await request(app).put('/api/settings').send({ musicApi: `${fake!.url}/` });
    expect(put.status).toBe(200);
    expect(put.body.musicApi).toBe(fake!.url);
    expect((await request(app).get('/api/health')).body.upstreamReachable).toBe(true);
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/v1/models', '/v1/audio/speech']));
  });

  it('templates: create, upsert by name, list, delete', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/templates').send({ prompt: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/templates').send({ name: 'Lo-fi' })).status).toBe(400);
    const c = await request(app).post('/api/templates').send({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '', duration: 90, format: 'mp3' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '[Instrumental]', duration: 90, format: 'mp3' });
    const u = await request(app).post('/api/templates').send({ name: 'lo-fi', prompt: 'lo-fi v2' });
    expect(u.status).toBe(200);
    expect(u.body.id).toBe(c.body.id);
    expect((await request(app).get('/api/templates')).body).toHaveLength(1);
    expect((await request(app).delete(`/api/templates/${c.body.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/templates/${c.body.id}`)).status).toBe(404);
  });

  it('settings: env-locked values cannot be changed and the key is never returned', async () => {
    const { app } = await setup({}, 'k');
    const s = await request(app).get('/api/settings');
    expect(s.body).toMatchObject({ apiKeySet: true, locked: { musicApi: true, apiKey: true }, source: { musicApi: 'env', apiKey: 'env' } });
    expect(JSON.stringify(s.body)).not.toContain('"k"');
    expect((await request(app).put('/api/settings').send({ musicApi: 'http://x:1' })).status).toBe(400);
  });

  it('settings: stored values apply, persist, and re-point the upstream client', async () => {
    const { app, dir, upstream } = await setup({}, null, { musicApi: null, apiKey: null });
    expect((await request(app).get('/api/settings')).body).toMatchObject({ musicApi: 'http://127.0.0.1:7862', apiKeySet: false, source: { musicApi: 'default', apiKey: 'none' } });
    expect((await request(app).put('/api/settings').send({ musicApi: 'not a url' })).status).toBe(400);
    const put = await request(app).put('/api/settings').send({ musicApi: `${fake!.url}/`, apiKey: 'sekrit' });
    expect(put.body).toMatchObject({ musicApi: fake!.url, apiKeySet: true, source: { musicApi: 'settings', apiKey: 'settings' } });
    expect(upstream.url).toBe(fake!.url);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ musicApi: fake!.url, apiKey: 'sekrit' });
    await request(app).get('/api/health');
    expect(fake!.requests.at(-1)?.auth).toBe('Bearer sekrit');
    expect((await request(app).put('/api/settings').send({ apiKey: '' })).body.apiKeySet).toBe(false);
  });

  it('settings/test probes a candidate URL without saving', async () => {
    const { app } = await setup({}, null, { musicApi: null, apiKey: null });
    const ok = await request(app).post('/api/settings/test').send({ musicApi: fake!.url });
    expect(ok.body).toMatchObject({ ok: true, musicApi: fake!.url, health: { ready: true, models: ['minimax_ttm'] } });
    const bad = await request(app).post('/api/settings/test').send({ musicApi: 'http://127.0.0.1:1' });
    expect(bad.body.ok).toBe(false);
    expect((await request(app).get('/api/settings')).body.musicApi).toBe('http://127.0.0.1:7862');
  });
});
