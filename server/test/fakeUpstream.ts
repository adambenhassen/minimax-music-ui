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
  /** advertised model id; null = no /v1/models route at all (stock sgl-omni per the model card) */
  modelId?: string | null;
  /** reject requests whose `model` differs from modelId (or DEFAULT when modelId is null) */
  strictModel?: boolean;
  /** expose GET /health answering 503 (model loading) — like inference/server.py; default: no /health route (stock sgl-omni) */
  loading?: boolean;
  /** advertise capabilities:["stream"] on /health and answer stream:true with SSE progress + PCM windows */
  stream?: { windows: number; windowMs?: number; sampleRate?: number; secondsPerWindow?: number };
}

/** Interleaved stereo int16 sine, `seconds` long. */
export function sinePcm(seconds: number, sampleRate = 44100, freq = 440): Buffer {
  const n = Math.round(seconds * sampleRate);
  const b = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
    b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2);
  }
  return b;
}

export interface FakeUpstream {
  url: string;
  requests: { method: string; path: string; body?: unknown; auth?: string; aborted?: boolean; stream?: boolean }[];
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

  const modelId = opts.modelId === undefined ? 'minimax_ttm' : opts.modelId;
  app.get('/v1/models', (req, res) => {
    requests.push({ method: 'GET', path: req.path, auth: req.header('authorization') ?? undefined });
    if (modelId === null) return res.status(404).json({ detail: 'Not Found' });
    res.json({ object: 'list', data: [{ id: modelId, object: 'model' }] });
  });

  if (opts.loading !== undefined || opts.stream) {
    app.get('/health', (req, res) => {
      requests.push({ method: 'GET', path: req.path });
      if (opts.loading) return res.status(503).json({ detail: 'loading model' });
      res.json({ status: 'ready', ...(opts.stream ? { capabilities: ['stream'] } : {}) });
    });
  }

  const streamRender = (res: express.Response, entry: FakeUpstream['requests'][number], b: Record<string, unknown>) => {
    const s = opts.stream!;
    const sr = s.sampleRate ?? 44100, per = s.secondsPerWindow ?? 0.5, gap = s.windowMs ?? 20;
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Seed': String(b.seed ?? 4242) });
    res.flushHeaders();
    entry.stream = true;
    const frames = Number(b.max_new_tokens ?? 1500);
    let step = 0; let seconds = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      if (step < 2) send('progress', { stage: 'semantic', done: Math.round((frames * (step + 1)) / 2), total: frames, secondsRendered: 0 });
      else if (step - 2 < s.windows) {
        const k = step - 2;
        send('progress', { stage: 'denoise', done: k * 30 + 30, total: s.windows * 30, secondsRendered: seconds });
        const pcm = sinePcm(per, sr, 220 * (k + 1));
        seconds += per;
        send('audio', { pcm: pcm.toString('base64'), samples: pcm.length / 4, sampleRate: sr, channels: 2 });
      } else {
        send('done', { seed: Number(b.seed ?? 4242), sampleRate: sr, channels: 2 });
        clearInterval(timer);
        res.end();
      }
      step++;
    }, gap);
    res.on('close', () => { if (!res.writableEnded) { entry.aborted = true; clearInterval(timer); } });
  };

  app.post('/v1/audio/speech', (req, res) => {
    const entry: FakeUpstream['requests'][number] = { method: 'POST', path: req.path, body: req.body, auth: req.header('authorization') ?? undefined, aborted: false, stream: false };
    requests.push(entry);
    const b = req.body ?? {};
    if (b.stream === true && !opts.stream) return res.status(400).json({ error: 'stream: true is not supported' });
    if (b.stream === true) return streamRender(res, entry, b);
    if (opts.strictModel && b.model !== (modelId ?? 'MiniMaxAI/MiniMax-Music3')) return res.status(404).json({ error: `model ${b.model} not found` });
    if (!b.instructions) return res.status(422).json({ detail: 'instructions required' });
    if ((b.response_format ?? 'wav') !== 'wav') return res.status(422).json({ detail: 'response_format must be wav' });
    const timer = setTimeout(() => {
      res.setHeader('Content-Type', 'audio/wav');
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
