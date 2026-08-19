import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import type { Library } from './library.js';
import { extFor, REALTIME_FACTOR } from './upstream.js';
import { normalizeGenerate } from './validate.js';
import { randomTitle } from './names.js';
import { FORMATS, type Track } from './types.js';

/**
 * Read-only public demo. The persisted library is the showcase (never modified); anything a
 * visitor "creates" is simulated in memory for that visitor only (cookie session), progresses
 * like a real render, and ends up pointing at one of the showcase files. Nothing reaches a GPU.
 */
export interface DemoOptions {
  /** how long a simulated render takes; default ≈ duration × 0.25 s, clamped 6–30 s */
  renderMs?: number;
  tickMs?: number;
  /** drop a visitor's simulated tracks after this long without a request */
  sessionTtlMs?: number;
  maxTracksPerSession?: number;
}

const COOKIE = 'demo_sid';
const READ_ONLY = { error: 'This is a read-only demo — changes are not saved.' };
const MIME: Record<string, string> = { wav: 'audio/wav' };
const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'track';

interface Session {
  tracks: Track[];
  lastSeen: number;
  running: boolean;
  timer: NodeJS.Timeout | null;
}

export function demoRouter(library: Library, tracksDir: string, opts: DemoOptions = {}): Router {
  const tickMs = opts.tickMs ?? 500;
  const sessionTtl = opts.sessionTtlMs ?? 2 * 3600_000;
  const maxTracks = opts.maxTracksPerSession ?? 20;
  const sessions = new Map<string, Session>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) if (now - s.lastSeen > sessionTtl && !s.running) { if (s.timer) clearInterval(s.timer); sessions.delete(sid); }
  }, 60_000);
  sweep.unref();

  const sessionOf = (req: Request, res: Response): Session => {
    const m = /(?:^|;\s*)demo_sid=([\w-]+)/.exec(req.headers.cookie ?? '');
    let sid = m?.[1];
    if (!sid || !sessions.has(sid)) {
      sid = sid && /^[\w-]{20,}$/.test(sid) ? sid : randomUUID();
      sessions.set(sid, { tracks: [], lastSeen: Date.now(), running: false, timer: null });
      res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'lax', maxAge: sessionTtl });
    }
    const s = sessions.get(sid)!;
    s.lastSeen = Date.now();
    return s;
  };

  const seeds = () => library.all().filter((t) => t.status === 'done' && t.file);

  const renderMsFor = (duration: number) => opts.renderMs ?? Math.min(30_000, Math.max(6_000, duration * 250));

  /** Run the visitor's queue one track at a time, like the real RenderQueue. */
  const pump = (s: Session) => {
    if (s.running) return;
    const track = s.tracks.slice().reverse().find((t) => t.status === 'queued'); // oldest first
    if (!track) return;
    s.running = true;
    const total = renderMsFor(track.duration);
    const startedAt = Date.now();
    const est = Math.max(5, track.duration * REALTIME_FACTOR);
    Object.assign(track, { status: 'running', stage: 'rendering', progress: 0, eta: est, elapsed: 0 });
    const finish = () => {
      if (s.timer) clearInterval(s.timer);
      s.timer = null;
      s.running = false;
      pump(s);
    };
    s.timer = setInterval(() => {
      if (!s.tracks.includes(track)) return finish(); // cancelled
      const frac = Math.min(1, (Date.now() - startedAt) / total);
      if (frac < 1) {
        Object.assign(track, { progress: Math.min(0.99, frac), elapsed: est * frac, eta: est * (1 - frac) });
        return;
      }
      const pool = seeds();
      const pick = pool.length ? pool[randomInt(pool.length)] : null;
      Object.assign(track, pick
        ? { status: 'done', stage: 'done', progress: 1, eta: null, elapsed: est, file: pick.file, format: pick.format, seed: track.seed ?? randomInt(1, 2 ** 31), finishedAt: new Date().toISOString() }
        : { status: 'error', stage: 'error', error: 'demo has no showcase audio to hand out', finishedAt: new Date().toISOString() });
      finish();
    }, tickMs);
  };

  const r = Router();

  r.get('/api/health', (_req, res) => {
    res.json({ demo: true, upstreamReachable: true, ready: true, busy: false, queued: 0, formats: FORMATS, capabilities: [], models: [] });
  });

  r.get('/api/library', (req, res) => {
    const s = sessionOf(req, res);
    res.json([...s.tracks, ...library.all()]);
  });

  r.post('/api/generate', (req, res, next) => {
    try {
      const s = sessionOf(req, res);
      const g = normalizeGenerate(req.body);
      if (s.tracks.length + g.takes > maxTracks) return res.status(429).json({ error: `Demo limit: at most ${maxTracks} simulated tracks per visitor — delete some first.` });
      const groupId = randomUUID();
      const title = g.title || randomTitle();
      const created: Track[] = [];
      for (let i = 0; i < g.takes; i++) {
        const track: Track = {
          id: randomUUID(), groupId, takeIndex: i, title, prompt: g.prompt, lyrics: g.lyrics, duration: g.duration,
          seed: g.seed === null ? null : g.seed + i, format: g.format, status: 'queued', progress: 0, stage: 'queued', eta: null,
          stream: false, renderedSeconds: null, error: null, file: null, createdAt: new Date().toISOString(), finishedAt: null,
        };
        s.tracks.unshift(track);
        created.push(track);
      }
      setImmediate(() => pump(s)); // respond with them queued, like the real queue does
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  r.delete('/api/tracks/:id', (req, res) => {
    const s = sessionOf(req, res);
    const i = s.tracks.findIndex((t) => t.id === req.params.id);
    if (i !== -1) { s.tracks.splice(i, 1); return res.json({ ok: true }); }
    if (library.get(req.params.id)) return res.status(403).json(READ_ONLY);
    res.status(404).json({ error: 'not found' });
  });

  r.get('/api/tracks/:id/audio', (req, res, next) => {
    const s = sessionOf(req, res);
    const track = s.tracks.find((t) => t.id === req.params.id);
    if (!track) return next(); // a showcase track: the normal handler serves it
    if (!track.file) return res.status(404).json({ error: 'no audio' });
    const type = MIME[extFor(track.format)] ?? 'application/octet-stream';
    const download = req.query.download !== undefined;
    res.sendFile(path.join(tracksDir, track.file), {
      headers: { 'Content-Type': type, ...(download ? { 'Content-Disposition': `attachment; filename="${safeName(track.title)}.${extFor(track.format)}"` } : {}) },
    }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'file missing' }); });
  });

  const readOnly = (_req: Request, res: Response) => { res.status(403).json(READ_ONLY); };
  r.put('/api/settings', readOnly);
  r.post('/api/settings/test', readOnly);
  r.post('/api/templates', readOnly);
  r.delete('/api/templates/:id', readOnly);

  return r;
}
