import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore, Library } from '../src/library.js';
import type { Template } from '../src/types.js';
import { UpstreamClient } from '../src/upstream.js';
import { Poller } from '../src/poller.js';
import { createApp, titleFromPrompt } from '../src/app.js';
import { startFakeUpstream, type FakeUpstream } from './fakeUpstream.js';

let fake: FakeUpstream | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

async function setup(opts: Parameters<typeof startFakeUpstream>[0] = {}, apiKey: string | null = null) {
  fake = await startFakeUpstream(opts);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  const lib = new Library(path.join(dir, 'library.json'));
  await lib.load();
  const upstream = new UpstreamClient(fake.url, apiKey);
  const tracksDir = path.join(dir, 'tracks');
  const poller = new Poller(lib, upstream, tracksDir, 1000, () => {});
  const templates = new JsonStore<Template>(path.join(dir, 'templates.json'));
  await templates.load();
  const app = createApp({ library: lib, templates, upstream, poller, tracksDir, log: () => {} });
  return { app, lib, poller, tracksDir };
}

describe('app', () => {
  it('health proxies upstream and reports reachability', async () => {
    const { app } = await setup({ formats: ['flac'] });
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ upstreamReachable: true, ready: true, formats: ['flac'] });
    await fake!.close(); fake = null;
    const down = await request(app).get('/api/health');
    expect(down.body.upstreamReachable).toBe(false);
    expect(down.body.formats).toEqual(['flac']);
  });

  it('generate creates N takes with incrementing seeds and forwards bearer', async () => {
    const { app, lib } = await setup({}, 'sekrit');
    const res = await request(app).post('/api/generate').send({ prompt: 'lo-fi hip hop, 80 BPM', takes: 3, seed: 100, format: 'flac', duration: 20 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((t: { seed: number }) => t.seed)).toEqual([100, 101, 102]);
    expect(res.body[0].groupId).toBe(res.body[2].groupId);
    expect(res.body[0].title).toBe('lo-fi hip hop, 80 BPM');
    expect(res.body.every((t: { jobId: string }) => t.jobId)).toBe(true);
    expect(lib.all()).toHaveLength(3);
    const gen = fake!.requests.filter((r) => r.path === '/generate');
    expect(gen).toHaveLength(3);
    expect(gen[0].auth).toBe('Bearer sekrit');
    expect(gen[0].body).toMatchObject({ prompt: 'lo-fi hip hop, 80 BPM', lyrics: '[Instrumental]', duration: 20, format: 'flac', wait: false });
  });

  it('rejects bad input', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/generate').send({})).status).toBe(400);
    expect((await request(app).post('/api/generate').send({ prompt: 'x', steps: 3 })).status).toBe(400);
  });

  it('marks track error when upstream is down at submit', async () => {
    const { app } = await setup();
    await fake!.close(); fake = null;
    const res = await request(app).post('/api/generate').send({ prompt: 'x' });
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ status: 'error' });
    expect(res.body[0].error).toMatch(/unreachable/);
  });

  it('full cycle: generate → poll → audio → delete', async () => {
    const { app, poller, tracksDir } = await setup();
    const { body } = await request(app).post('/api/generate').send({ prompt: 'ambient piano', format: 'mp3' });
    const id = body[0].id;
    for (let i = 0; i < 8; i++) await poller.tick();
    const lib = await request(app).get('/api/library');
    expect(lib.body[0]).toMatchObject({ id, status: 'done', file: `${id}.mp3` });
    const audio = await request(app).get(`/api/tracks/${id}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    const dl = await request(app).get(`/api/tracks/${id}/audio?download`);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="ambient piano.mp3"/);
    const del = await request(app).delete(`/api/tracks/${id}`);
    expect(del.status).toBe(200);
    await expect(fs.access(path.join(tracksDir, `${id}.mp3`))).rejects.toThrow();
    expect((await request(app).get('/api/library')).body).toEqual([]);
    expect((await request(app).delete(`/api/tracks/${id}`)).status).toBe(404);
  });

  it('delete cancels in-flight jobs upstream', async () => {
    const { app } = await setup();
    const { body } = await request(app).post('/api/generate').send({ prompt: 'x' });
    await request(app).delete(`/api/tracks/${body[0].id}`);
    expect(fake!.requests.some((r) => r.method === 'DELETE' && r.path === `/jobs/${body[0].jobId}`)).toBe(true);
  });

  it('templates: create, upsert by name, list, delete', async () => {
    const { app } = await setup();
    expect((await request(app).post('/api/templates').send({ prompt: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/templates').send({ name: 'Lo-fi' })).status).toBe(400);
    const c = await request(app).post('/api/templates').send({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '', duration: 90, format: 'mp3', steps: 40 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Lo-fi', prompt: 'lo-fi hip hop', lyrics: '[Instrumental]', duration: 90, format: 'mp3', steps: 40 });
    const u = await request(app).post('/api/templates').send({ name: 'lo-fi', prompt: 'lo-fi v2' });
    expect(u.status).toBe(200);
    expect(u.body.id).toBe(c.body.id);
    const list = await request(app).get('/api/templates');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].prompt).toBe('lo-fi v2');
    expect((await request(app).delete(`/api/templates/${c.body.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/templates/${c.body.id}`)).status).toBe(404);
    expect((await request(app).get('/api/templates')).body).toEqual([]);
  });

  it('titleFromPrompt strips structured prefix', () => {
    expect(titleFromPrompt('Global Metadata: genre dream pop, 92 BPM, D major, wistful')).toBe('genre dream pop, 92 BPM, D');
    expect(titleFromPrompt('   ')).toBe('Untitled');
  });
});
