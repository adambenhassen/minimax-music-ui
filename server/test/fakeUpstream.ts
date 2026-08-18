import express from 'express';
import type { Server } from 'node:http';

/**
 * Fake MiniMax-Music3 server (same shape as `sgl-omni serve`):
 * GET /v1/models + blocking POST /v1/audio/speech that returns audio bytes after `renderMs`.
 */
export interface FakeUpstreamOptions {
  renderMs?: number;
  audioBytes?: Buffer;
  prefix?: string;
  port?: number;
}

export interface FakeUpstream {
  url: string;
  requests: { method: string; path: string; body?: unknown; auth?: string; aborted?: boolean }[];
  close(): Promise<void>;
}

export async function startFakeUpstream(opts: FakeUpstreamOptions = {}): Promise<FakeUpstream> {
  const root = express();
  const app = express();
  root.use(opts.prefix ?? '/', app);
  app.use(express.json());
  const requests: FakeUpstream['requests'] = [];
  const audio = opts.audioBytes ?? Buffer.from('RIFF-fake-audio');
  const renderMs = opts.renderMs ?? 30;

  app.get('/v1/models', (req, res) => {
    requests.push({ method: 'GET', path: req.path, auth: req.header('authorization') ?? undefined });
    res.json({ object: 'list', data: [{ id: 'minimax_ttm', object: 'model' }] });
  });

  app.post('/v1/audio/speech', (req, res) => {
    const entry = { method: 'POST', path: req.path, body: req.body, auth: req.header('authorization') ?? undefined, aborted: false };
    requests.push(entry);
    const b = req.body ?? {};
    if (b.stream === true) return res.status(400).json({ error: 'stream: true is not supported' });
    if (!b.instructions) return res.status(422).json({ detail: 'instructions required' });
    if (!['wav', 'flac', 'mp3'].includes(b.response_format ?? 'wav')) return res.status(422).json({ detail: 'response_format must be wav, flac or mp3' });
    const timer = setTimeout(() => {
      res.setHeader('Content-Type', b.response_format === 'mp3' ? 'audio/mpeg' : b.response_format === 'flac' ? 'audio/flac' : 'audio/wav');
      res.setHeader('X-Seed', String(b.seed ?? 4242));
      res.send(audio);
    }, renderMs);
    res.on('close', () => { if (!res.headersSent) { entry.aborted = true; clearTimeout(timer); } });
  });

  const server: Server = await new Promise((resolve) => { const s = root.listen(opts.port ?? 0, '127.0.0.1', () => resolve(s)); });
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}${opts.prefix ?? ''}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
