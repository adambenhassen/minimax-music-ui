import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, Library } from '../src/library.js';
import type { Template, Track } from '../src/types.js';
import { RenderQueue, UpstreamClient } from '../src/upstream.js';
import { createApp } from '../src/app.js';
import { SettingsStore, type EnvOverrides } from '../src/settings.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';
import { SkillFiles } from '../src/enhance.js';
import { startFakeLlm, type FakeLlm } from './fakeLlm.js';

let fake: FakeUpstream | null = null;
afterEach(async () => { await fake?.close(); fake = null; });
let llm: FakeLlm | null = null;
afterEach(async () => { await llm?.close(); llm = null; });

const writeRequest = (app: ReturnType<typeof createApp>) => ({
  post: (url: string) => request(app).post(url).set('X-Requested-With', 'XMLHttpRequest'),
  put: (url: string) => request(app).put(url).set('X-Requested-With', 'XMLHttpRequest'),
  delete: (url: string) => request(app).delete(url).set('X-Requested-With', 'XMLHttpRequest'),
});

async function setup(opts: Parameters<typeof startFakeUpstream>[0] = {}, apiKey: string | null = null, env: EnvOverrides | null = null, uiToken: string | null = null, log: (msg: string) => void = () => {}) {
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
  // unreachable base: tests never hit GitHub; they seed the cache instead
  const skill = new SkillFiles(path.join(dir, 'skill-cache'), 'http://127.0.0.1:1');
  const previousUiToken = process.env.UI_TOKEN;
  if (uiToken === null) delete process.env.UI_TOKEN;
  else process.env.UI_TOKEN = uiToken;
  const app = createApp({ library: lib, templates, settings, upstream, queue, tracksDir, skill, log });
  if (previousUiToken === undefined) delete process.env.UI_TOKEN;
  else process.env.UI_TOKEN = previousUiToken;
  return { app, lib, tracksDir, dir, settings, upstream, queue };
}

const seedSkill = async (dir: string) => {
  await fs.mkdir(path.join(dir, 'skill-cache'), { recursive: true });
  await fs.writeFile(path.join(dir, 'skill-cache', 'SKILL.md'), '# skill');
};

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
    expect(res.body).toMatchObject({ upstreamReachable: true, ready: true, busy: false, queued: 0, formats: ['wav'], models: ['minimax_ttm'], capabilities: [] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);
    await fake!.close(); fake = null;
    const cached = await request(app).get('/api/health');
    expect(cached.body).toMatchObject({ upstreamReachable: true, models: ['minimax_ttm'], formats: ['wav'] });
  });

  it('coalesces concurrent health probes and reuses a completed result briefly', async () => {
    const { app } = await setup({ stream: { windows: 1 }, modelsResponseDelayMs: 100, healthResponseDelayMs: 100 });
    const responses = await Promise.all(Array.from({ length: 10 }, () => request(app).get('/api/health')));
    expect(responses.every((res) => res.body.upstreamReachable && res.body.ready)).toBe(true);
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const followup = await request(app).get('/api/health');
    expect(followup.body).toMatchObject({ upstreamReachable: true, capabilities: ['stream'] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);
  });

  it('times out a stalled /v1/models probe and caches its failed result for concurrent pollers', async () => {
    const { app } = await setup({ modelsResponseDelayMs: 8000 });
    const startedAt = Date.now();
    const responses = await Promise.all(Array.from({ length: 10 }, () => request(app).get('/api/health')));
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(4500);
    expect(elapsedMs).toBeLessThan(7500);
    expect(responses.every((res) => res.body.upstreamReachable === false && /probe timed out/i.test(res.body.error))).toBe(true);
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const cached = await request(app).get('/api/health');
    expect(cached.body).toMatchObject({ upstreamReachable: false, ready: false });
    expect(cached.body.error).toMatch(/probe timed out/i);
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);
  }, 15000);

  it('treats a stalled optional /health probe as ready after its timeout', async () => {
    const { app } = await setup({ healthResponseDelayMs: 8000 });
    const startedAt = Date.now();
    const result = await request(app).get('/api/health');
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(4500);
    expect(elapsedMs).toBeLessThan(7500);
    expect(result.body).toMatchObject({ upstreamReachable: true, ready: true, models: ['minimax_ttm'] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);
  }, 15000);

  it('generate → queue → speech → file: maps fields, serialises takes, forwards bearer', async () => {
    const { app, lib } = await setup({ renderMs: 120 }, 'sekrit');
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'ambient', lyrics: '', duration: 10, takes: 2, seed: 5 });
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
    expect(lib.get(a.id)).toMatchObject({ status: 'done', file: `${a.id}.wav`, seed: 5, progress: 1, eta: 0 });
    const speech = fake!.requests.filter((r) => r.path === '/v1/audio/speech');
    expect(speech).toHaveLength(2);
    expect(speech[0].auth).toBe('Bearer sekrit');
    expect(speech[0].body).toEqual({ model: 'minimax_ttm', input: '[Instrumental]', instructions: 'ambient', response_format: 'wav', max_new_tokens: 250, stream: false, seed: 5 });
    expect(speech[1].body).toMatchObject({ seed: 6 });
    const audio = await request(app).get(`/api/tracks/${a.id}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/wav');
    expect(Buffer.from(audio.body).toString()).toBe('RIFF-fake-audio');
    const dl = await request(app).get(`/api/tracks/${a.id}/audio?download`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename=".+\.wav"$/);
  });

  it('uses the model id advertised by /v1/models', async () => {
    const { app, lib } = await setup({ modelId: 'MiniMaxAI/MiniMax-Music3', strictModel: true });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ model: 'MiniMaxAI/MiniMax-Music3' });
  });

  it('reports ready:false while an optional /health answers 503, true once it recovers', async () => {
    const { app, upstream } = await setup({ loading: true });
    const loading = await request(app).get('/api/health');
    expect(loading.body).toMatchObject({ upstreamReachable: true, ready: false, models: ['minimax_ttm'] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);
    await fake!.close();
    fake = await startFakeUpstream({ loading: false, port: Number(new URL(fake!.url).port) });
    upstream.configure(fake!.url);
    const ready = await request(app).get('/api/health');
    expect(ready.body).toMatchObject({ upstreamReachable: true, ready: true });
  });

  it('works against a server without /v1/models (official card shape): reachable + default model id', async () => {
    const { app, lib } = await setup({ modelId: null, strictModel: true });
    const h = await request(app).get('/api/health');
    expect(h.body).toMatchObject({ upstreamReachable: true, ready: true, models: [] });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ model: 'MiniMaxAI/MiniMax-Music3' });
  });

  it('random seed → seed reported by the server (X-Seed) is stored', async () => {
    const { app, lib } = await setup();
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.body[0].seed).toBeNull();
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(lib.get(res.body[0].id)?.seed).toBe(4242);
    expect(fake!.requests.at(-1)?.body).not.toHaveProperty('seed');
  });

  it('rejects bad input', async () => {
    const { app } = await setup();
    expect((await writeRequest(app).post('/api/generate').send({})).status).toBe(400);
    expect((await writeRequest(app).post('/api/generate').send({ prompt: 'x', format: 'flac' })).status).toBe(400);
    expect((await writeRequest(app).post('/api/generate').send({ prompt: 'x', seed: 1.5 })).status).toBe(400);
  });

  it('records upstream failures on the track', async () => {
    const { app, lib } = await setup();
    await fake!.close(); fake = null;
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.status).toBe(201);
    await until(() => lib.get(res.body[0].id)?.status === 'error');
    expect(lib.get(res.body[0].id)?.error).toMatch(/unreachable/);
    expect(lib.get(res.body[0].id)?.file).toBeNull();
  });

  it('delete: removes queued, aborts running, deletes finished files', async () => {
    const { app, lib, queue, tracksDir } = await setup({ renderMs: 500 });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', takes: 2 });
    const [a, b] = res.body as Track[];
    await until(() => lib.get(a.id)?.status === 'running');
    expect((await writeRequest(app).delete(`/api/tracks/${b.id}`)).status).toBe(200);
    expect(queue.queued).toBe(0);
    expect((await writeRequest(app).delete(`/api/tracks/${a.id}`)).status).toBe(200);
    await until(() => !queue.busy);
    await until(() => fake!.requests.some((r) => r.aborted));
    expect(lib.all()).toEqual([]);
    expect((await writeRequest(app).delete(`/api/tracks/${a.id}`)).status).toBe(404);

    const done = await writeRequest(app).post('/api/generate').send({ prompt: 'y', title: 'ambient piano' });
    const id = done.body[0].id;
    await until(() => lib.get(id)?.status === 'done');
    await fs.access(path.join(tracksDir, `${id}.wav`));
    expect((await writeRequest(app).delete(`/api/tracks/${id}`)).status).toBe(200);
    await expect(fs.access(path.join(tracksDir, `${id}.wav`))).rejects.toThrow();
  });

  it('recover fails a running render after a restart and re-enqueues queued ones in order', async () => {
    const { lib, queue } = await setup();
    const base = { groupId: 'g', takeIndex: 0, title: 'T', prompt: 'p', lyrics: '[Instrumental]', duration: 10, seed: null, format: 'wav', progress: 0, eta: null, error: null, file: null, finishedAt: null };
    await lib.add({ ...base, id: 'o1', status: 'running', progress: 0.3, stage: 'rendering', createdAt: '2026-01-01T00:00:00.000Z' });
    await lib.add({ ...base, id: 'q2', status: 'queued', stage: 'queued', createdAt: '2026-01-01T00:00:02.000Z' });
    await lib.add({ ...base, id: 'q1', status: 'queued', stage: 'queued', createdAt: '2026-01-01T00:00:01.000Z' });
    expect(await queue.recover()).toEqual({ failed: 1, resumed: 2 });
    expect(lib.get('o1')).toMatchObject({ status: 'error', error: /restart/ });
    await until(() => lib.get('q1')?.status === 'done' && lib.get('q2')?.status === 'done');
    expect(Date.parse(lib.get('q1')!.finishedAt!)).toBeLessThanOrEqual(Date.parse(lib.get('q2')!.finishedAt!));
  });

  it('uses the given title when present, random otherwise', async () => {
    const { app } = await setup();
    expect((await writeRequest(app).post('/api/generate').send({ prompt: 'x', title: '  Pine Morning ' })).body[0].title).toBe('Pine Morning');
    expect((await writeRequest(app).post('/api/generate').send({ prompt: 'x' })).body[0].title).toMatch(/^[A-Z][A-Za-z&' ]+$/);
  });

  it('works with a path-prefixed upstream base URL and trailing slash', async () => {
    const { app, lib } = await setup({ prefix: '/upstream/music3' }, null, { musicApi: null, apiKey: null });
    const put = await writeRequest(app).put('/api/settings').send({ musicApi: `${fake!.url}/` });
    expect(put.status).toBe(200);
    expect(put.body.musicApi).toBe(fake!.url);
    expect((await request(app).get('/api/health')).body.upstreamReachable).toBe(true);
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.map((r) => r.path)).toEqual(expect.arrayContaining(['/v1/models', '/v1/audio/speech']));
  });

  it('templates: create, upsert by name, list, delete', async () => {
    const { app } = await setup();
    expect((await writeRequest(app).post('/api/templates').send({ prompt: 'x' })).status).toBe(400);
    expect((await writeRequest(app).post('/api/templates').send({ name: 'Lo-fi' })).status).toBe(400);
    const c = await writeRequest(app).post('/api/templates').send({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '', duration: 90 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '[Instrumental]', duration: 90, format: 'wav' });
    const u = await writeRequest(app).post('/api/templates').send({ name: 'lo-fi', prompt: 'lo-fi v2' });
    expect(u.status).toBe(200);
    expect(u.body.id).toBe(c.body.id);
    expect((await request(app).get('/api/templates')).body).toHaveLength(1);
    expect((await writeRequest(app).delete(`/api/templates/${c.body.id}`)).status).toBe(200);
    expect((await writeRequest(app).delete(`/api/templates/${c.body.id}`)).status).toBe(404);
  });

  it('settings: env-locked values cannot be changed and the key is never returned', async () => {
    const { app } = await setup({}, 'k');
    const s = await request(app).get('/api/settings');
    expect(s.body).toMatchObject({ apiKeySet: true, locked: { musicApi: true, apiKey: true }, source: { musicApi: 'env', apiKey: 'env' } });
    expect(JSON.stringify(s.body)).not.toContain('"k"');
    expect((await writeRequest(app).put('/api/settings').send({ musicApi: 'http://x:1' })).status).toBe(400);
  });

  it('settings: stored values apply, persist, and re-point the upstream client', async () => {
    const { app, dir, upstream } = await setup({}, null, { musicApi: null, apiKey: null });
    expect((await request(app).get('/api/settings')).body).toMatchObject({ musicApi: 'http://127.0.0.1:7862', apiKeySet: false, source: { musicApi: 'default', apiKey: 'none' } });
    expect((await writeRequest(app).put('/api/settings').send({ musicApi: 'not a url' })).status).toBe(400);
    const put = await writeRequest(app).put('/api/settings').send({ musicApi: `${fake!.url}/`, apiKey: 'sekrit' });
    expect(put.body).toMatchObject({ musicApi: fake!.url, apiKeySet: true, source: { musicApi: 'settings', apiKey: 'settings' } });
    expect(upstream.url).toBe(fake!.url);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ musicApi: fake!.url, apiKey: 'sekrit', compat: false, llmApi: null, llmApiKey: null, llmModel: null });
    await request(app).get('/api/health');
    expect(fake!.requests.at(-1)?.auth).toBe('Bearer sekrit');
    expect((await writeRequest(app).put('/api/settings').send({ apiKey: '' })).body.apiKeySet).toBe(false);
  });

  it('settings changes to URL, key, or compat invalidate the cached upstream probe', async () => {
    const { app } = await setup({ stream: { windows: 1 } }, null, { musicApi: null, apiKey: null });
    expect((await request(app).get('/api/health')).body.capabilities).toEqual(['stream']);
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);

    const next = await startFakeUpstream({ stream: { windows: 1 } });
    try {
      const switched = await writeRequest(app).put('/api/settings').send({ musicApi: next.url, apiKey: 'fresh-key' });
      expect(switched.status).toBe(200);
      const newTarget = await request(app).get('/api/health');
      expect(newTarget.body).toMatchObject({ upstreamReachable: true, capabilities: ['stream'] });
      expect(next.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);
      expect(next.requests[0]?.auth).toBe('Bearer fresh-key');

      const changedCompat = await writeRequest(app).put('/api/settings').send({ compat: true });
      expect(changedCompat.status).toBe(200);
      const compatible = await request(app).get('/api/health');
      expect(compatible.body).toMatchObject({ upstreamReachable: true, ready: true, capabilities: [] });
      expect(next.requests.map((r) => r.path)).toEqual(['/v1/models', '/health', '/v1/models']);
      expect(next.requests.at(-1)?.auth).toBe('Bearer fresh-key');
    } finally {
      await next.close();
    }
  });

  it('keeps queue and enhancement fields live while reusing cached upstream health', async () => {
    const { app, lib, queue, settings } = await setup({ renderMs: 150 });
    await request(app).get('/api/health');
    const generated = await writeRequest(app).post('/api/generate').send({ prompt: 'x', takes: 2 });
    await until(() => queue.busy && queue.queued === 1);
    await settings.update({ llmApi: 'http://127.0.0.1:9999/v1', llmModel: 'test-model' });

    const live = await request(app).get('/api/health');
    expect(live.body).toMatchObject({ busy: true, queued: 1, formats: ['wav'], enhance: true });
    expect(fake!.requests.filter((r) => r.path === '/v1/models')).toHaveLength(1);
    await until(() => lib.get(generated.body[0].id)?.status === 'done' && lib.get(generated.body[1].id)?.status === 'done');
  });

  it('settings/test probes a candidate URL without saving', async () => {
    const { app } = await setup({}, null, { musicApi: null, apiKey: null });
    const ok = await writeRequest(app).post('/api/settings/test').send({ musicApi: fake!.url });
    expect(ok.body).toMatchObject({ ok: true, musicApi: fake!.url, health: { ready: true, models: ['minimax_ttm'] } });
    const bad = await writeRequest(app).post('/api/settings/test').send({ musicApi: 'http://127.0.0.1:1' });
    expect(bad.body.ok).toBe(false);
    expect((await request(app).get('/api/settings')).body.musicApi).toBe('http://127.0.0.1:7862');
  });

  it('settings/test probes a stalled candidate live with the health timeout, outside the shared cache', async () => {
    const { app } = await setup({}, null, { musicApi: null, apiKey: null });
    await request(app).get('/api/health');
    const candidate = await startFakeUpstream({ modelsResponseDelayMs: 8000 });
    try {
      const startedAt = Date.now();
      const probe = writeRequest(app).post('/api/settings/test').send({ musicApi: candidate.url }).then((result) => result);
      await until(() => candidate.requests.length === 1);
      const configured = await request(app).get('/api/health');
      expect(configured.body.upstreamReachable).toBe(true);
      expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);

      const result = await probe;
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(4500);
      expect(elapsedMs).toBeLessThan(7500);
      expect(result.body.ok).toBe(false);
      expect(result.body.error).toMatch(/probe timed out/i);
      expect(candidate.requests.map((r) => r.path)).toEqual(['/v1/models']);
    } finally {
      await candidate.close();
    }
  }, 15000);

  it('settings/test only reuses a saved music key for the same origin', async () => {
    const { app } = await setup({}, null, { musicApi: null, apiKey: null });
    await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url, apiKey: 'saved-key' });
    const other = await startFakeUpstream();
    try {
      const withoutKey = await writeRequest(app).post('/api/settings/test').send({ musicApi: other.url });
      expect(withoutKey.status).toBe(200);
      expect(withoutKey.body.ok).toBe(true);
      expect(other.requests[0]?.auth).toBeUndefined();

      const withKey = await writeRequest(app).post('/api/settings/test').send({ musicApi: other.url, apiKey: 'candidate-key' });
      expect(withKey.status).toBe(200);
      expect(other.requests.at(-1)?.auth).toBe('Bearer candidate-key');

      const sameOrigin = await writeRequest(app).post('/api/settings/test').send({ musicApi: `${fake!.url}/` });
      expect(sameOrigin.body.ok).toBe(true);
      expect(fake!.requests.at(-1)?.auth).toBe('Bearer saved-key');
    } finally {
      await other.close();
    }
  });

  it('settings PUT clears old music and LLM keys when origins change unless replaced', async () => {
    const { app, dir } = await setup({}, null, { musicApi: null, apiKey: null });
    const otherMusic = await startFakeUpstream();
    const oldLlm = await startFakeLlm([{ content: 'ok' }]);
    const newLlm = await startFakeLlm([{ content: 'ok' }]);
    await seedSkill(dir);
    try {
      await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url, apiKey: 'music-old', llmApi: oldLlm.url, llmApiKey: 'llm-old', llmModel: 'test-model' });

      const sameOrigin = await writeRequest(app).put('/api/settings').send({ musicApi: `${fake!.url}/path`, llmApi: `${oldLlm.url}/path` });
      expect(sameOrigin.body).toMatchObject({ apiKeySet: true, llmKeySet: true });
      await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url, llmApi: oldLlm.url });

      await request(app).get('/api/health');
      expect(fake!.requests.at(-1)?.auth).toBe('Bearer music-old');
      await writeRequest(app).post('/api/enhance').send({ prompt: 'test' });
      expect(oldLlm.requests.at(-1)?.auth).toBe('Bearer llm-old');

      const movedMusic = await writeRequest(app).put('/api/settings').send({ musicApi: otherMusic.url });
      expect(movedMusic.body.apiKeySet).toBe(false);
      await request(app).get('/api/health');
      expect(otherMusic.requests.at(-1)?.auth).toBeUndefined();

      const replacedMusic = await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url, apiKey: 'music-new' });
      expect(replacedMusic.body.apiKeySet).toBe(true);
      await request(app).get('/api/health');
      expect(fake!.requests.at(-1)?.auth).toBe('Bearer music-new');

      const movedLlm = await writeRequest(app).put('/api/settings').send({ llmApi: newLlm.url });
      expect(movedLlm.body.llmKeySet).toBe(false);
      await writeRequest(app).post('/api/enhance').send({ prompt: 'test' });
      expect(newLlm.requests.at(-1)?.auth).toBeUndefined();

      const replacedLlm = await writeRequest(app).put('/api/settings').send({ llmApi: oldLlm.url, llmApiKey: 'llm-new' });
      expect(replacedLlm.body.llmKeySet).toBe(true);
      await writeRequest(app).post('/api/enhance').send({ prompt: 'test' });
      expect(oldLlm.requests.at(-1)?.auth).toBe('Bearer llm-new');
    } finally {
      await otherMusic.close();
      await oldLlm.close();
      await newLlm.close();
    }
  });

  it('rejects changing an API origin when its key is environment-locked', async () => {
    const { app, dir } = await setup({}, null, { musicApi: null, apiKey: 'env-music-key', llmApi: null, llmApiKey: 'env-llm-key', llmModel: null });
    const otherLlm = await startFakeLlm([{ content: 'ok' }]);
    try {
      const test = await writeRequest(app).post('/api/settings/test').send({ musicApi: fake!.url });
      expect(test.status).toBe(400);
      expect(test.body.error).toMatch(/MUSIC_API_KEY/);
      expect(fake!.requests).toHaveLength(0);

      const music = await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url });
      expect(music.status).toBe(400);
      expect(music.body.error).toMatch(/MUSIC_API_KEY/);

      const llm = await writeRequest(app).put('/api/settings').send({ llmApi: otherLlm.url });
      expect(llm.status).toBe(400);
      expect(llm.body.error).toMatch(/LLM_API_KEY/);
      expect(otherLlm.requests).toHaveLength(0);

      expect((await request(app).get('/api/settings')).body).toMatchObject({
        musicApi: 'http://127.0.0.1:7862', apiKeySet: true, llmApi: null, llmKeySet: true,
      });
      await expect(fs.readFile(path.join(dir, 'settings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await otherLlm.close();
    }
  });

  it('settings: LLM fields persist, gate health.enhance, and never return the key', async () => {
    const { app, dir } = await setup();
    expect((await request(app).get('/api/health')).body.enhance).toBe(false);
    expect((await writeRequest(app).put('/api/settings').send({ llmApi: 'ftp://x' })).status).toBe(400);
    const put = await writeRequest(app).put('/api/settings').send({ llmApi: 'http://llm.test/v1/', llmApiKey: 'llm-sekrit', llmModel: 'gpt-x' });
    expect(put.body).toMatchObject({
      llmApi: 'http://llm.test/v1', llmModel: 'gpt-x', llmKeySet: true,
      source: { llmApi: 'settings', llmApiKey: 'settings', llmModel: 'settings' },
      locked: { llmApi: false, llmApiKey: false, llmModel: false },
    });
    expect(JSON.stringify(put.body)).not.toContain('llm-sekrit');
    expect((await request(app).get('/api/health')).body.enhance).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject({ llmApi: 'http://llm.test/v1', llmApiKey: 'llm-sekrit', llmModel: 'gpt-x' });
    expect((await writeRequest(app).put('/api/settings').send({ llmModel: '' })).body.llmModel).toBeNull();
    expect((await request(app).get('/api/health')).body.enhance).toBe(false);
    await fake!.close(); fake = null;
    await writeRequest(app).put('/api/settings').send({ llmModel: 'gpt-x' });
    expect((await request(app).get('/api/health')).body).toMatchObject({ upstreamReachable: false, enhance: true });
  });

  it('enhance: 400 without a prompt, 409 until an LLM is configured, then returns the caption', async () => {
    const { app, dir } = await setup();
    expect((await writeRequest(app).post('/api/enhance').send({ prompt: ' ' })).status).toBe(400);
    const off = await writeRequest(app).post('/api/enhance').send({ prompt: 'sad piano' });
    expect(off.status).toBe(409);
    expect(off.body.error).toMatch(/not configured/);
    await seedSkill(dir);
    llm = await startFakeLlm([{ content: '### Global Metadata\nslow piano' }]);
    await writeRequest(app).put('/api/settings').send({ llmApi: llm.url, llmModel: 'm' });
    const on = await writeRequest(app).post('/api/enhance').send({ prompt: 'sad piano', lyrics: '[Verse]\nx', instrumental: false });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ prompt: '### Global Metadata\nslow piano' });
    expect(llm.requests[0].body.messages[1].content).toBe('Caption: sad piano\n\nLyrics:\n[Verse]\nx');
    expect(fake!.requests.some((r) => r.path.includes('speech'))).toBe(false);
  });

  it('lyrics: 400 without a prompt, 409 until an LLM is configured, then returns lyrics', async () => {
    const { app } = await setup();
    expect((await writeRequest(app).post('/api/lyrics').send({ prompt: '' })).status).toBe(400);
    const off = await writeRequest(app).post('/api/lyrics').send({ prompt: 'night drive', duration: 30 });
    expect(off.status).toBe(409);
    expect(off.body.error).toMatch(/not configured/);
    llm = await startFakeLlm([{ content: '[Verse]\nNeon' }]);
    await writeRequest(app).put('/api/settings').send({ llmApi: llm.url, llmModel: 'm' });
    const on = await writeRequest(app).post('/api/lyrics').send({ prompt: 'night drive', duration: 30 });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ lyrics: '[Verse]\nNeon' });
    expect(llm.requests[0].body.messages[1].content).toContain('Target length: 30 s');
  });

  it('enhance: LLM failure maps to 502 with the reason', async () => {
    const { app, dir } = await setup();
    await seedSkill(dir);
    llm = await startFakeLlm([{ status: 500 }]);
    await writeRequest(app).put('/api/settings').send({ llmApi: llm.url, llmModel: 'm' });
    const res = await writeRequest(app).post('/api/enhance').send({ prompt: 'sad piano' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/LLM error 500/);
  });

  it('settings: a rejected PUT changes nothing, even fields that validated', async () => {
    const { app, dir } = await setup();
    expect((await writeRequest(app).put('/api/settings').send({ llmApi: 'http://ok.test/v1', llmModel: 5 })).status).toBe(400);
    expect((await request(app).get('/api/settings')).body.llmApi).toBeNull();
    await writeRequest(app).put('/api/settings').send({ compat: true });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject({ compat: true, llmApi: null });
  });

  it('settings: env-locked LLM fields cannot be changed and the key is never returned', async () => {
    const { app } = await setup({}, null, { musicApi: null, apiKey: null, llmApi: 'http://env-llm/v1', llmApiKey: 'envk', llmModel: 'm' });
    const s = await request(app).get('/api/settings');
    expect(s.body).toMatchObject({ llmApi: 'http://env-llm/v1', llmModel: 'm', llmKeySet: true, locked: { llmApi: true, llmApiKey: true, llmModel: true }, source: { llmApi: 'env', llmApiKey: 'env', llmModel: 'env' } });
    expect(JSON.stringify(s.body)).not.toContain('envk');
    expect((await writeRequest(app).put('/api/settings').send({ llmModel: 'other' })).status).toBe(400);
    expect((await writeRequest(app).put('/api/settings').send({ llmApiKey: 'x' })).status).toBe(400);
  });

  it('streams when advertised: real stage/progress/renderedSeconds, file appears early, valid WAV at the end', async () => {
    const { app, lib, tracksDir } = await setup({ stream: { windows: 4, secondsPerWindow: 0.1, windowMs: 40 } });
    const h = await request(app).get('/api/health');
    expect(h.body.capabilities).toEqual(['stream']);
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', duration: 10, stream: true });
    const id = res.body[0].id as string;
    await until(() => lib.get(id)?.stage === 'semantic');
    await until(() => (lib.get(id)?.renderedSeconds ?? 0) > 0);
    const mid = lib.get(id)!;
    expect(mid.status).toBe('running');
    expect(mid.stage).toBe('denoise');
    expect(mid.file).toBe(`${id}.wav`);
    expect(mid.progress).toBeGreaterThan(0.35);
    await until(() => lib.get(id)?.status === 'done');
    const t = lib.get(id)!;
    expect(t.renderedSeconds).toBeCloseTo(0.4, 1);
    expect(t.progress).toBe(1);
    const wav = await fs.readFile(path.join(tracksDir, t.file!));
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: true });
  });

  it('without the per-track stream flag: progress is still real over SSE (stream_audio:false), no early audio, valid WAV', async () => {
    const { app, lib, tracksDir } = await setup({ stream: { windows: 3, secondsPerWindow: 0.1, windowMs: 40 } });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x' });
    const id = res.body[0].id as string;
    await until(() => lib.get(id)?.stage === 'denoise');
    expect(lib.get(id)?.renderedSeconds).toBeNull();
    expect(lib.get(id)?.file).toBeNull();
    await until(() => lib.get(id)?.status === 'done');
    const t = lib.get(id)!;
    expect(t.renderedSeconds).toBeNull();
    expect(t.progress).toBe(1);
    const wav = await fs.readFile(path.join(tracksDir, t.file!));
    expect(wav.length).toBe(44 + Math.round(0.1 * 44100) * 4 * 3);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: true, stream_audio: false });
  });

  it('never sends stream:true to servers that do not advertise it', async () => {
    const { app, lib } = await setup({ loading: false });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', stream: true });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: false });
    expect(lib.get(res.body[0].id)?.renderedSeconds).toBeNull();
  });

  it('compat mode ignores /health and never streams, even when the server advertises it', async () => {
    const { app, lib } = await setup({ stream: { windows: 3, windowMs: 40 } }, null, { musicApi: null, apiKey: null });
    await writeRequest(app).put('/api/settings').send({ musicApi: fake!.url });
    expect((await request(app).get('/api/health')).body).toMatchObject({ ready: true, capabilities: ['stream'] });
    const put = await writeRequest(app).put('/api/settings').send({ compat: true });
    expect(put.status).toBe(200);
    expect(put.body.compat).toBe(true);
    fake!.requests.length = 0;
    expect((await request(app).get('/api/health')).body).toMatchObject({ ready: true, capabilities: [] });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', stream: true });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.map((r) => r.path)).not.toContain('/health');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: false });
    expect((await request(app).get('/api/settings')).body.compat).toBe(true);
  });

  it('cancel mid-stream aborts upstream and marks cancelled', async () => {
    const { app, lib } = await setup({ stream: { windows: 50, windowMs: 40 } });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', stream: true });
    const id = res.body[0].id as string;
    await until(() => (lib.get(id)?.renderedSeconds ?? 0) > 0);
    await writeRequest(app).delete(`/api/tracks/${id}`);
    await until(() => fake!.requests.find((r) => r.path === '/v1/audio/speech')?.aborted === true);
    expect(lib.get(id)).toBeUndefined();
  });

  it('audio route serves the partial WAV of a running track with a patched header and honours Range', async () => {
    const { app, lib } = await setup({ stream: { windows: 40, secondsPerWindow: 0.1, windowMs: 40 } });
    const res = await writeRequest(app).post('/api/generate').send({ prompt: 'x', stream: true });
    const id = res.body[0].id as string;
    await until(() => (lib.get(id)?.renderedSeconds ?? 0) >= 0.2);
    const bin = (r: request.Response, cb: (err: Error | null, body: Buffer) => void) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
    const full = await request(app).get(`/api/tracks/${id}/audio`).buffer(true).parse(bin);
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    const buf = full.body as Buffer;
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(40)).toBe(buf.length - 44);
    expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    expect(buf.length).toBeGreaterThanOrEqual(44 + Math.round(0.2 * 44100) * 4);
    const part = await request(app).get(`/api/tracks/${id}/audio`).set('Range', 'bytes=40-51').buffer(true).parse(bin);
    expect(part.status).toBe(206);
    expect((part.body as Buffer).length).toBe(12);
    expect(part.headers['content-range']).toMatch(/^bytes 40-51\/\d+$/);
    await writeRequest(app).delete(`/api/tracks/${id}`);
  });

  it('requires credentials for API reads when UI_TOKEN is set', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    expect((await request(app).get('/api/library')).status).toBe(401);
    expect((await request(app).get('/api/future-route')).status).toBe(401);
  });

  it('requires credentials for API reads regardless of path casing', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    expect((await request(app).get('/API/library')).status).toBe(401);
  });

  it('applies the write guard to paths with different casing', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    expect((await request(app).post('/API/generate').send({ prompt: 'x' })).status).toBe(403);
  });

  it('requires credentials for API writes when UI_TOKEN is set', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    const res = await request(app).post('/api/generate').set('X-Requested-With', 'XMLHttpRequest').send({ prompt: 'x' });
    expect(res.status).toBe(401);
  });

  it('accepts the configured UI_TOKEN as a bearer credential', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    const res = await request(app).get('/api/library').set('Authorization', 'Bearer test-ui-token');
    expect(res.status).toBe(200);
  });

  it('sets a strict HttpOnly auth cookie that grants access without a request header', async () => {
    const logs: string[] = [];
    const { app, lib } = await setup({ renderMs: 30 }, null, null, 'test-ui-token', (msg) => logs.push(msg));
    const auth = await request(app).post('/api/auth').set('X-Requested-With', 'XMLHttpRequest').send({ token: 'test-ui-token' });
    expect(auth.status).toBe(204);
    const cookie = auth.headers['set-cookie']?.[0];
    expect(cookie).toBeDefined();
    expect(cookie).not.toContain('test-ui-token');
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; SameSite=Strict');
    expect(cookie).toContain('; Path=/api');
    expect(cookie).not.toContain('; Secure');
    expect(JSON.stringify(auth.body)).not.toContain('test-ui-token');

    const res = await request(app).get('/api/library').set('Cookie', cookie!.split(';', 1)[0]);
    expect(res.status).toBe(200);

    const created = await request(app).post('/api/generate').set('Authorization', 'Bearer test-ui-token').send({ prompt: 'x' });
    const id = created.body[0].id as string;
    await until(() => lib.get(id)?.status === 'done');
    const audio = await request(app).get(`/api/tracks/${id}/audio`).set('Cookie', cookie!.split(';', 1)[0]);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toMatch(/^audio\/wav/);
    const download = await request(app).get(`/api/tracks/${id}/audio?download`).set('Cookie', cookie!.split(';', 1)[0]);
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename=".+\.wav"$/);
    expect(logs.join('\n')).not.toContain('test-ui-token');
  });

  it('rejects an incorrect auth token without setting a cookie', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    const res = await request(app).post('/api/auth').set('X-Requested-With', 'XMLHttpRequest').send({ token: 'wrong-token' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('wrong-token');
  });

  it('keeps GET /api/ping public without probing the upstream', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(fake!.requests).toEqual([]);
  });

  it('rejects a write without either protection header when UI_TOKEN is unset', async () => {
    const { app } = await setup();
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.status).toBe(403);
  });

  it('applies the write guard even when UI_TOKEN is set', async () => {
    const { app } = await setup({}, null, null, 'test-ui-token');
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.status).toBe(403);
  });

  it('warns at startup when UI_TOKEN is unset', async () => {
    const logs: string[] = [];
    await setup({}, null, null, null, (msg) => logs.push(msg));
    expect(logs.join('\n')).toMatch(/unauthenticated/i);
  });
});
