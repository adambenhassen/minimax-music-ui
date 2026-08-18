import express from 'express';
import type { Server } from 'node:http';
import type { UpstreamJob } from '../src/types.js';

/**
 * Fake of the MiniMax-Music3 inference API. Each POST /generate creates a job whose
 * GET /jobs/:id responses walk a scripted list of states (last state repeats).
 */
export interface FakeUpstreamOptions {
  formats?: string[];
  ready?: boolean;
  /** states per job in order; default queued → running → done */
  script?: (jobId: string, body: Record<string, unknown>) => UpstreamJob[];
  audioBytes?: Buffer;
  /** milliseconds between auto-advances; 0 = advance on every poll */
  autoAdvanceMs?: number;
  /** mount the API under a path prefix, e.g. '/upstream/music3' */
  prefix?: string;
}

export interface FakeUpstream {
  url: string;
  app: express.Express;
  close(): Promise<void>;
  requests: { method: string; path: string; body?: unknown; auth?: string }[];
  jobs: Map<string, { states: UpstreamJob[]; idx: number; body: Record<string, unknown>; last: number }>;
}

let counter = 0;

export function defaultScript(jobId: string, body: Record<string, unknown>): UpstreamJob[] {
  const duration = Number(body.duration ?? 60);
  const format = String(body.format ?? 'wav');
  const seed = typeof body.seed === 'number' ? body.seed : 424242;
  return [
    { job_id: jobId, status: 'queued', progress: 0, stage: 'queued', eta: null, seed, duration, format },
    { job_id: jobId, status: 'running', progress: 0.1, stage: 'generating audio tokens', eta: duration * 2.7, elapsed: 4.2, seed, duration, format },
    { job_id: jobId, status: 'running', progress: 0.5, stage: 'step 210/420', eta: duration * 1.3, elapsed: duration * 1.4, seed, duration, format },
    { job_id: jobId, status: 'running', progress: 0.95, stage: 'decoding audio', eta: 5, elapsed: duration * 2.6, seed, duration, format },
    {
      job_id: jobId, status: 'done', progress: 1, stage: 'done', eta: 0, seed, duration, format,
      audio_url: `/jobs/${jobId}/audio`, sampling_rate: 44100, channels: 2, encoding: 'PCM_24', peak_dbfs: -1.2, clipped: false,
    },
  ];
}

export async function startFakeUpstream(opts: FakeUpstreamOptions = {}): Promise<FakeUpstream> {
  const root = express();
  const app = express();
  root.use(opts.prefix ?? '/', app);
  app.use(express.json());
  const requests: FakeUpstream['requests'] = [];
  const jobs: FakeUpstream['jobs'] = new Map();
  const audio = opts.audioBytes ?? Buffer.from('RIFF-fake-audio');
  const autoAdvanceMs = opts.autoAdvanceMs ?? 0;

  app.use((req, _res, next) => {
    requests.push({ method: req.method, path: req.path, body: req.body, auth: req.header('authorization') ?? undefined });
    next();
  });

  app.get('/health', (_req, res) => {
    const busy = [...jobs.values()].some((j) => j.states[j.idx].status === 'running');
    const queued = [...jobs.values()].filter((j) => j.states[j.idx].status === 'queued').length;
    res.json({ ready: opts.ready ?? true, busy, queued, sampling_rate: 44100, formats: opts.formats ?? ['wav', 'wav16', 'wav32f', 'flac', 'mp3'] });
  });

  app.post('/generate', (req, res) => {
    if (!req.body?.prompt) return res.status(422).json({ detail: 'prompt required' });
    const jobId = `job${(++counter).toString(16).padStart(4, '0')}`;
    const states = (opts.script ?? defaultScript)(jobId, req.body);
    jobs.set(jobId, { states, idx: 0, body: req.body, last: Date.now() });
    res.json({ job_id: jobId, status: 'queued' });
  });

  app.get('/jobs', (_req, res) => {
    res.json([...jobs.entries()].reverse().map(([, j]) => j.states[j.idx]));
  });

  app.get('/jobs/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ detail: 'not found' });
    const state = j.states[j.idx];
    const now = Date.now();
    if (j.idx < j.states.length - 1 && now - j.last >= autoAdvanceMs) {
      j.idx++;
      j.last = now;
    }
    res.json(state);
  });

  app.get('/jobs/:id/audio', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j || j.states[j.idx].status !== 'done') return res.status(404).json({ detail: 'not ready' });
    res.setHeader('Content-Type', 'audio/wav');
    res.send(audio);
  });

  app.delete('/jobs/:id', (req, res) => {
    if (!jobs.delete(req.params.id)) return res.status(404).json({ detail: 'not found' });
    res.json({ ok: true });
  });

  const server: Server = await new Promise((resolve) => {
    const s = root.listen(opts.autoAdvanceMs !== undefined && process.env.FAKE_PORT ? Number(process.env.FAKE_PORT) : 0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}${opts.prefix ?? ''}`,
    app,
    requests,
    jobs,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
