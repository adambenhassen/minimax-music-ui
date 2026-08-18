import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonStore, Library } from './library.js';
import { extFor, RenderQueue, UpstreamClient, UpstreamError } from './upstream.js';
import { normalizeGenerate, ValidationError } from './validate.js';
import { normalizeMusicApi, SettingsStore } from './settings.js';
import { randomTitle } from './names.js';
import { FORMATS, type Template, type Track } from './types.js';

export interface AppDeps {
  library: Library;
  templates: JsonStore<Template>;
  settings: SettingsStore;
  upstream: UpstreamClient;
  queue: RenderQueue;
  tracksDir: string;
  staticDir?: string | null;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg' };

export function createApp(deps: AppDeps) {
  const { library, templates, settings, upstream, queue, tracksDir } = deps;
  const log = deps.log ?? ((m: string) => console.log(`[app] ${m}`));
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      const h = await upstream.health();
      res.json({ upstreamReachable: true, ready: h.ready, models: h.models, busy: queue.busy, queued: queue.queued, formats: FORMATS });
    } catch (err) {
      res.json({ upstreamReachable: false, ready: false, busy: queue.busy, queued: queue.queued, formats: FORMATS, error: (err as Error).message });
    }
  });

  app.get('/api/library', (_req, res) => {
    res.json(library.all());
  });

  app.post('/api/generate', async (req, res, next) => {
    try {
      const g = normalizeGenerate(req.body);
      const groupId = randomUUID();
      const title = g.title || randomTitle();
      const created: Track[] = [];
      for (let i = 0; i < g.takes; i++) {
        const track: Track = {
          id: randomUUID(),
          groupId,
          takeIndex: i,
          title,
          prompt: g.prompt,
          lyrics: g.lyrics,
          duration: g.duration,
          seed: g.seed === null ? null : g.seed + i,
          format: g.format,
          status: 'queued',
          progress: 0,
          stage: 'queued',
          eta: null,
          error: null,
          file: null,
          createdAt: new Date().toISOString(),
          finishedAt: null,
        };
        await library.add(track);
        queue.enqueue(track.id);
        created.push(track);
      }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/tracks/:id', async (req, res) => {
    const track = library.get(req.params.id);
    if (!track) return res.status(404).json({ error: 'not found' });
    if (track.status === 'queued' || track.status === 'running') queue.cancel(track.id);
    if (track.file) await fs.rm(path.join(tracksDir, track.file), { force: true });
    await library.remove(track.id);
    res.json({ ok: true });
  });

  app.get('/api/tracks/:id/audio', (req, res) => {
    const track = library.get(req.params.id);
    if (!track || !track.file) return res.status(404).json({ error: 'no audio' });
    const abs = path.join(tracksDir, track.file);
    const type = MIME[extFor(track.format)] ?? 'application/octet-stream';
    const download = req.query.download !== undefined;
    res.sendFile(abs, {
      headers: {
        'Content-Type': type,
        ...(download ? { 'Content-Disposition': `attachment; filename="${safeName(track.title)}.${extFor(track.format)}"` } : {}),
      },
    }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file missing' });
    });
  });

  app.get('/api/settings', (_req, res) => {
    res.json(settings.publicView());
  });

  app.put('/api/settings', async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      await settings.update({ musicApi: b.musicApi, apiKey: b.apiKey });
      const e = settings.effective();
      upstream.configure(e.musicApi, e.apiKey);
      log(`upstream reconfigured → ${e.musicApi}${e.apiKey ? ' (bearer set)' : ''}`);
      res.json(settings.publicView());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/settings/test', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const e = settings.effective();
    const locked = settings.publicView().locked;
    let url = e.musicApi;
    let key = e.apiKey;
    try {
      if (typeof b.musicApi === 'string' && !locked.musicApi) url = normalizeMusicApi(b.musicApi);
      if (typeof b.apiKey === 'string' && !locked.apiKey) key = b.apiKey.trim() || null;
    } catch (err) {
      return res.status(400).json({ ok: false, error: (err as Error).message });
    }
    try {
      const h = await new UpstreamClient(url, key).health();
      res.json({ ok: true, musicApi: url, health: { ...h, formats: FORMATS } });
    } catch (err) {
      res.json({ ok: false, musicApi: url, error: (err as Error).message });
    }
  });

  app.get('/api/templates', (_req, res) => {
    res.json(templates.all());
  });

  app.post('/api/templates', async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
      if (!name) throw new ValidationError('name is required');
      const g = normalizeGenerate({ ...b, prompt: b.prompt, takes: 1 });
      const existing = templates.all().find((t) => t.name.toLowerCase() === name.toLowerCase());
      const tpl: Template = {
        id: existing?.id ?? randomUUID(),
        name,
        prompt: g.prompt,
        lyrics: g.lyrics,
        duration: g.duration,
        format: g.format,
        createdAt: new Date().toISOString(),
      };
      if (existing) await templates.update(existing.id, tpl);
      else await templates.add(tpl);
      res.status(existing ? 200 : 201).json(tpl);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/templates/:id', async (req, res) => {
    const removed = await templates.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  if (deps.staticDir) {
    app.use(express.static(deps.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(deps.staticDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof UpstreamError) return res.status(502).json({ error: err.message });
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON' });
    }
    log(`unhandled: ${(err as Error).stack ?? err}`);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'track';
