import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Library } from './library.js';
import type { Track } from './types.js';
import { parseSse } from './sse.js';
import { patchWavSizes, wavHeader, WAV_HEADER_BYTES } from './wav.js';

/** MiniMax-Music3 renders ~2.5–3× slower than realtime; drives the estimated progress bar. */
export const REALTIME_FACTOR = 3;
const FRAMES_PER_SECOND = 25;
const MAX_FRAMES = 9000;

const EXT: Record<string, string> = { wav: 'wav' };
/** Model id in the official model card's example; used when /v1/models doesn't tell us otherwise. */
export const DEFAULT_MODEL = 'MiniMaxAI/MiniMax-Music3';
export const extFor = (format: string) => EXT[format] ?? format;

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export interface SpeechBody {
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  format: string;
}

export interface UpstreamHealth {
  ready: boolean;
  /** ids from GET /v1/models; empty when the server doesn't expose that route */
  models: string[];
  /** optional extras advertised by GET /health (e.g. "stream"); empty for stock servers */
  capabilities: string[];
}

export type StreamEvent =
  | { type: 'progress'; stage: 'semantic' | 'denoise'; done: number; total: number }
  | { type: 'audio'; secondsRendered: number };

/**
 * Client for the MiniMax-Music3 server contract (same shape as `sgl-omni serve`):
 *   GET  /v1/models        → {data:[{id:"minimax_ttm"}]}
 *   POST /v1/audio/speech  → audio bytes (blocking for the whole render)
 */
export class UpstreamClient {
  private modelId: string | null = null;
  private capabilities: string[] = [];
  private probed = false;

  /** `compat`: pretend the server is stock sgl-omni — skip GET /health, so no loading state and no extras. */
  constructor(private baseUrl: string, private apiKey: string | null = null, private compat = false) {}

  configure(baseUrl: string, apiKey: string | null, compat = false): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.compat = compat;
    this.modelId = null;
    this.capabilities = [];
    this.probed = false;
  }

  /** Probe once (model id + capabilities) unless a health() call already did since configure(). */
  async ensureProbed(): Promise<void> {
    if (!this.probed) await this.health().catch(() => undefined);
  }

  /** true iff the last health probe advertised the optional `stream` extension (SSE progress + PCM windows). */
  get canStream(): boolean {
    return this.capabilities.includes('stream');
  }

  /** Model id sent in requests: whatever /v1/models advertised, else the official default. */
  get model(): string {
    return this.modelId ?? DEFAULT_MODEL;
  }

  get url(): string {
    return this.baseUrl;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  /**
   * Reachability probe via GET /v1/models. Any HTTP answer means the server is up — a 404 just
   * means this build doesn't expose the models list (the official card only documents
   * /v1/audio/speech). Only a failed connection counts as unreachable.
   * `ready` comes from an optional GET /health: a 503 means the model is still loading; anything
   * else (404 on stock sgl-omni, timeouts) counts as ready. Its JSON may list `capabilities`.
   */
  async health(): Promise<UpstreamHealth> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers() });
    } catch (err) {
      throw new UpstreamError(`upstream unreachable: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new UpstreamError(`upstream ${res.status} on /v1/models — check the API key`, res.status);
    let models: string[] = [];
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      models = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
      if (models.length) this.modelId = models[0];
    }
    const h = this.compat ? { ready: true, capabilities: [] } : await this.probeHealth();
    this.capabilities = h.capabilities;
    this.probed = true;
    return { ready: h.ready, models, capabilities: h.capabilities };
  }

  /** GET /health is optional: 503 = model still loading; its JSON may list `capabilities`. */
  private async probeHealth(): Promise<{ ready: boolean; capabilities: string[] }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { headers: this.headers() });
      if (res.status === 503) return { ready: false, capabilities: [] };
      const json = (await res.json().catch(() => ({}))) as { capabilities?: unknown };
      const caps = Array.isArray(json.capabilities) ? json.capabilities.filter((c): c is string => typeof c === 'string') : [];
      return { ready: true, capabilities: caps };
    } catch {
      return { ready: true, capabilities: [] };
    }
  }

  private async post(body: SpeechBody, stream: boolean, signal?: AbortSignal, extra: Record<string, unknown> = {}): Promise<Response> {
    await this.ensureProbed();
    const payload = {
      model: this.model,
      input: body.lyrics,
      instructions: body.prompt,
      response_format: body.format,
      max_new_tokens: Math.min(MAX_FRAMES, Math.max(1, Math.round(body.duration * FRAMES_PER_SECOND))),
      stream,
      ...(body.seed !== null ? { seed: body.seed } : {}),
      ...extra,
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new UpstreamError(`upstream unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UpstreamError(`upstream ${res.status} on /v1/audio/speech: ${text.slice(0, 300)}`, res.status);
    }
    return res;
  }

  private static seedOf(res: Response): number | null {
    const h = res.headers.get('x-seed');
    return h !== null && h !== '' && Number.isFinite(Number(h)) ? Number(h) : null;
  }

  /** POST /v1/audio/speech, streaming the audio into `dest`. Returns the seed the server reports (X-Seed), if any. */
  async speechToFile(body: SpeechBody, dest: string, signal?: AbortSignal): Promise<{ seed: number | null }> {
    const res = await this.post(body, false, signal);
    if (!res.body) throw new UpstreamError('empty audio body');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(dest), { signal });
    return { seed: UpstreamClient.seedOf(res) };
  }

  /**
   * stream:true variant (only when `canStream`): SSE with progress + PCM windows, assembled into a WAV at `dest`.
   * `audio: false` asks for progress only (`stream_audio: false`); the clip then arrives in one event at the end.
   */
  async speechStream(body: SpeechBody, dest: string, onEvent: (e: StreamEvent) => void, signal?: AbortSignal, opts: { audio?: boolean } = {}): Promise<{ seed: number | null }> {
    const res = await this.post(body, true, signal, opts.audio === false ? { stream_audio: false } : {});
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream') || !res.body) {
      throw new UpstreamError(`upstream did not stream (content-type ${res.headers.get('content-type') ?? 'none'})`, res.status);
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const fd = await fsp.open(dest, 'w');
    let header: Buffer | null = null;
    let dataBytes = 0, samples = 0, sampleRate = 44100, channels = 2, finished = false;
    let seed = UpstreamClient.seedOf(res);
    try {
      for await (const ev of parseSse(res.body as ReadableStream<Uint8Array>)) {
        const d = JSON.parse(ev.data) as Record<string, unknown>;
        if (ev.event === 'progress') {
          onEvent({ type: 'progress', stage: d.stage === 'denoise' ? 'denoise' : 'semantic', done: Number(d.done) || 0, total: Number(d.total) || 0 });
        } else if (ev.event === 'audio') {
          if (typeof d.sampleRate === 'number') sampleRate = d.sampleRate;
          if (typeof d.channels === 'number') channels = d.channels;
          const pcm = Buffer.from(String(d.pcm ?? ''), 'base64');
          if (!header) { header = wavHeader(sampleRate, channels, 0); await fd.write(header, 0, WAV_HEADER_BYTES, 0); }
          await fd.write(pcm, 0, pcm.length, WAV_HEADER_BYTES + dataBytes);
          dataBytes += pcm.length;
          samples += pcm.length / (2 * channels);
          onEvent({ type: 'audio', secondsRendered: samples / sampleRate });
        } else if (ev.event === 'done') {
          if (typeof d.seed === 'number') seed = d.seed;
          finished = true;
        } else if (ev.event === 'error') {
          throw new UpstreamError(`upstream render failed: ${String(d.message ?? 'unknown error')}`);
        }
      }
      if (!finished) throw new UpstreamError('upstream stream ended before done');
      if (!header) throw new UpstreamError('upstream stream carried no audio');
      await fd.write(patchWavSizes(header, WAV_HEADER_BYTES + dataBytes), 0, WAV_HEADER_BYTES, 0);
    } finally {
      await fd.close();
    }
    return { seed };
  }
}

/**
 * One-at-a-time render queue. The upstream call blocks for the whole render and reports no
 * progress, so we keep our own queue (for "queued" state + cancel) and estimate progress
 * from elapsed time — unless the upstream advertises `stream`, in which case progress and
 * audio windows arrive live and the track's file grows on disk while it renders.
 */
export class RenderQueue {
  private queue: string[] = [];
  private current: { id: string; ac: AbortController } | null = null;

  constructor(
    private readonly library: Library,
    private readonly client: UpstreamClient,
    private readonly tracksDir: string,
    private readonly log: (msg: string) => void = (m) => console.log(`[render] ${m}`),
    private readonly tickMs = 1000,
  ) {}

  get busy(): boolean { return this.current !== null; }
  get queued(): number { return this.queue.length; }

  enqueue(id: string): void {
    this.queue.push(id);
    void this.pump();
  }

  /** Remove from queue or abort the running render. Returns true if it was ours. */
  cancel(id: string): boolean {
    const i = this.queue.indexOf(id);
    if (i !== -1) { this.queue.splice(i, 1); return true; }
    if (this.current?.id === id) { this.current.ac.abort(); return true; }
    return false;
  }

  /** On boot: a render that was in flight can't be reattached (the upstream call is gone), so it fails;
   *  tracks that were still queued are re-enqueued in their original order. */
  async recover(): Promise<{ failed: number; resumed: number }> {
    const all = this.library.all();
    const running = all.filter((t) => t.status === 'running');
    for (const t of running) {
      await this.library.update(t.id, { status: 'error', stage: 'error', error: 'interrupted by UI server restart', finishedAt: new Date().toISOString() });
    }
    const queued = all.filter((t) => t.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const t of queued) this.enqueue(t.id);
    return { failed: running.length, resumed: queued.length };
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const id = this.queue.shift();
    if (!id) return;
    const track = this.library.get(id);
    if (!track) return void this.pump();

    const ac = new AbortController();
    this.current = { id, ac };
    const startedAt = Date.now();
    const est = Math.max(5, track.duration * REALTIME_FACTOR);
    await this.client.ensureProbed();
    const streaming = this.client.canStream;           // real progress whenever the upstream offers it
    const audioWindows = streaming && track.stream;     // early playback is opt-in per track
    await this.library.update(id, { status: 'running', stage: streaming ? 'semantic' : 'rendering', progress: 0, eta: est, elapsed: 0, renderedSeconds: audioWindows ? 0 : null });

    const rel = `${id}.${extFor(track.format)}`;
    const dest = path.join(this.tracksDir, rel);
    const elapsedS = () => (Date.now() - startedAt) / 1000;

    // real progress state (streaming only)
    let frac = 0, stage: 'semantic' | 'denoise' = 'semantic', rendered = 0, fileKnown = false, lastWrite = 0;
    const onEvent = (e: StreamEvent) => {
      if (e.type === 'progress') {
        const part = e.total > 0 ? Math.min(1, e.done / e.total) : 0;
        const stageChanged = e.stage !== stage;
        stage = e.stage;
        frac = stage === 'semantic' ? 0.35 * part : 0.35 + 0.65 * part;
        if (!stageChanged && Date.now() - lastWrite < 250) return; // throttle store writes; stage changes and audio always write
      } else {
        rendered = e.secondsRendered;
      }
      lastWrite = Date.now();
      const elapsed = elapsedS();
      const eta = frac > 0.02 ? Math.max(0, elapsed / frac - elapsed) : Math.max(0, est - elapsed);
      const patch: Partial<Track> = { stage, progress: Math.min(0.99, frac), eta, elapsed, renderedSeconds: rendered };
      if (!audioWindows) patch.renderedSeconds = null; // whole clip arrives at the end; nothing to play early
      else if (rendered > 0 && !fileKnown) { fileKnown = true; patch.file = rel; }
      void this.library.update(id, patch);
    };

    const timer = setInterval(() => {
      const elapsed = elapsedS();
      if (streaming) void this.library.update(id, { elapsed });
      else void this.library.update(id, { elapsed, progress: Math.min(0.95, elapsed / est), eta: Math.max(0, est - elapsed) });
    }, this.tickMs);

    try {
      const body = { prompt: track.prompt, lyrics: track.lyrics, duration: track.duration, seed: track.seed, format: track.format };
      const { seed } = streaming
        ? await this.client.speechStream(body, dest, onEvent, ac.signal, { audio: audioWindows })
        : await this.client.speechToFile(body, dest, ac.signal);
      clearInterval(timer);
      await this.library.update(id, {
        status: 'done', stage: 'done', progress: 1, eta: 0,
        elapsed: elapsedS(),
        seed: seed ?? track.seed,
        file: rel,
        renderedSeconds: audioWindows ? rendered : null,
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      clearInterval(timer);
      await fsp.rm(dest, { force: true }).catch(() => {});
      const aborted = (err as Error).name === 'AbortError' || ac.signal.aborted;
      if (this.library.get(id)) {
        await this.library.update(id, {
          status: 'error', stage: 'error',
          error: aborted ? 'cancelled' : (err as Error).message,
          elapsed: elapsedS(),
          file: null, renderedSeconds: null,
          finishedAt: new Date().toISOString(),
        });
      }
      if (!aborted) this.log(`render ${id} failed: ${(err as Error).message}`);
    } finally {
      this.current = null;
      void this.pump();
    }
  }
}
