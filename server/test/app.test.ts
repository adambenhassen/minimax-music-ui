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
    expect(res.body).toMatchObject({ upstreamReachable: true, ready: true, busy: false, queued: 0, formats: ['wav'], models: ['minimax_ttm'], capabilities: [] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models']);
    await fake!.close(); fake = null;
    const down = await request(app).get('/api/health');
    expect(down.body.upstreamReachable).toBe(false);
    expect(down.body.error).toMatch(/unreachable/);
    expect(down.body.formats).toEqual(['wav']);
  });

  it('generate → queue → speech → file: maps fields, serialises takes, forwards bearer', async () => {
    const { app, lib } = await setup({ renderMs: 120 }, 'sekrit');
    const res = await request(app).post('/api/generate').send({ prompt: 'ambient', lyrics: '', duration: 10, takes: 2, seed: 5 });
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
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ model: 'MiniMaxAI/MiniMax-Music3' });
  });

  it('reports ready:false while an optional /health answers 503, true once it recovers', async () => {
    const { app } = await setup({ loading: true });
    const loading = await request(app).get('/api/health');
    expect(loading.body).toMatchObject({ upstreamReachable: true, ready: false, models: ['minimax_ttm'] });
    expect(fake!.requests.map((r) => r.path)).toEqual(['/v1/models', '/health']);
    await fake!.close();
    fake = await startFakeUpstream({ loading: false, port: Number(new URL(fake!.url).port) });
    const ready = await request(app).get('/api/health');
    expect(ready.body).toMatchObject({ upstreamReachable: true, ready: true });
  });

  it('works against a server without /v1/models (official card shape): reachable + default model id', async () => {
    const { app, lib } = await setup({ modelId: null, strictModel: true });
    const h = await request(app).get('/api/health');
    expect(h.body).toMatchObject({ upstreamReachable: true, ready: true, models: [] });
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ model: 'MiniMaxAI/MiniMax-Music3' });
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
    expect((await request(app).post('/api/generate').send({ prompt: 'x', format: 'flac' })).status).toBe(400);
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

    const done = await request(app).post('/api/generate').send({ prompt: 'y', title: 'ambient piano' });
    const id = done.body[0].id;
    await until(() => lib.get(id)?.status === 'done');
    await fs.access(path.join(tracksDir, `${id}.wav`));
    expect((await request(app).delete(`/api/tracks/${id}`)).status).toBe(200);
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
    const c = await request(app).post('/api/templates').send({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '', duration: 90 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '[Instrumental]', duration: 90, format: 'wav' });
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
    expect(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ musicApi: fake!.url, apiKey: 'sekrit', compat: false });
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

  it('streams when advertised: real stage/progress/renderedSeconds, file appears early, valid WAV at the end', async () => {
    const { app, lib, tracksDir } = await setup({ stream: { windows: 4, secondsPerWindow: 0.1, windowMs: 40 } });
    const h = await request(app).get('/api/health');
    expect(h.body.capabilities).toEqual(['stream']);
    const res = await request(app).post('/api/generate').send({ prompt: 'x', duration: 10, stream: true });
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
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
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
    const res = await request(app).post('/api/generate').send({ prompt: 'x', stream: true });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: false });
    expect(lib.get(res.body[0].id)?.renderedSeconds).toBeNull();
  });

  it('compat mode ignores /health and never streams, even when the server advertises it', async () => {
    const { app, lib } = await setup({ stream: { windows: 3, windowMs: 40 } }, null, { musicApi: null, apiKey: null });
    await request(app).put('/api/settings').send({ musicApi: fake!.url });
    expect((await request(app).get('/api/health')).body).toMatchObject({ ready: true, capabilities: ['stream'] });
    const put = await request(app).put('/api/settings').send({ compat: true });
    expect(put.status).toBe(200);
    expect(put.body.compat).toBe(true);
    fake!.requests.length = 0;
    expect((await request(app).get('/api/health')).body).toMatchObject({ ready: true, capabilities: [] });
    const res = await request(app).post('/api/generate').send({ prompt: 'x', stream: true });
    await until(() => lib.get(res.body[0].id)?.status === 'done');
    expect(fake!.requests.map((r) => r.path)).not.toContain('/health');
    expect(fake!.requests.find((r) => r.path === '/v1/audio/speech')?.body).toMatchObject({ stream: false });
    expect((await request(app).get('/api/settings')).body.compat).toBe(true);
  });

  it('cancel mid-stream aborts upstream and marks cancelled', async () => {
    const { app, lib } = await setup({ stream: { windows: 50, windowMs: 40 } });
    const res = await request(app).post('/api/generate').send({ prompt: 'x', stream: true });
    const id = res.body[0].id as string;
    await until(() => (lib.get(id)?.renderedSeconds ?? 0) > 0);
    await request(app).delete(`/api/tracks/${id}`);
    await until(() => fake!.requests.find((r) => r.path === '/v1/audio/speech')?.aborted === true);
    expect(lib.get(id)).toBeUndefined();
  });

  it('audio route serves the partial WAV of a running track with a patched header and honours Range', async () => {
    const { app, lib } = await setup({ stream: { windows: 40, secondsPerWindow: 0.1, windowMs: 40 } });
    const res = await request(app).post('/api/generate').send({ prompt: 'x', stream: true });
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
    await request(app).delete(`/api/tracks/${id}`);
  });
});
