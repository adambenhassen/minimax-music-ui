import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Library } from './library.js';
import type { Track } from './types.js';

/** MiniMax-Music3 renders ~2.5–3× slower than realtime; drives the estimated progress bar. */
export const REALTIME_FACTOR = 3;
const FRAMES_PER_SECOND = 25;
const MAX_FRAMES = 9000;

const EXT: Record<string, string> = { wav: 'wav', flac: 'flac', mp3: 'mp3' };
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
  models: string[];
}

/**
 * Client for the MiniMax-Music3 server contract (same shape as `sgl-omni serve`):
 *   GET  /v1/models        → {data:[{id:"minimax_ttm"}]}
 *   POST /v1/audio/speech  → audio bytes (blocking for the whole render)
 */
export class UpstreamClient {
  constructor(private baseUrl: string, private apiKey: string | null = null) {}

  configure(baseUrl: string, apiKey: string | null): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  get url(): string {
    return this.baseUrl;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  /** Reachability probe: the server is up when /v1/models answers. */
  async health(): Promise<UpstreamHealth> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers() });
    } catch (err) {
      throw new UpstreamError(`upstream unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new UpstreamError(`upstream ${res.status} on /v1/models`, res.status);
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
    const models = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return { ready: true, models };
  }

  /** POST /v1/audio/speech, streaming the audio into `dest`. Returns the seed the server reports (X-Seed), if any. */
  async speechToFile(body: SpeechBody, dest: string, signal?: AbortSignal): Promise<{ seed: number | null }> {
    const payload = {
      model: 'minimax_ttm',
      input: body.lyrics,
      instructions: body.prompt,
      response_format: body.format,
      max_new_tokens: Math.min(MAX_FRAMES, Math.max(1, Math.round(body.duration * FRAMES_PER_SECOND))),
      stream: false,
      ...(body.seed !== null ? { seed: body.seed } : {}),
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
    if (!res.body) throw new UpstreamError('empty audio body');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(dest), { signal });
    const seedHeader = res.headers.get('x-seed');
    const seed = seedHeader !== null && seedHeader !== '' && Number.isFinite(Number(seedHeader)) ? Number(seedHeader) : null;
    return { seed };
  }
}

/**
 * One-at-a-time render queue. The upstream call blocks for the whole render and reports no
 * progress, so we keep our own queue (for "queued" state + cancel) and estimate progress
 * from elapsed time.
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

  /** On boot: anything left queued/running by a previous process can't be resumed. */
  async failOrphans(): Promise<number> {
    const orphans = this.library.all().filter((t) => t.status === 'queued' || t.status === 'running');
    for (const t of orphans) {
      await this.library.update(t.id, { status: 'error', stage: 'error', error: 'interrupted by UI server restart', finishedAt: new Date().toISOString() });
    }
    return orphans.length;
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
    await this.library.update(id, { status: 'running', stage: 'rendering', progress: 0, eta: est, elapsed: 0 });

    const timer = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      void this.library.update(id, { elapsed, progress: Math.min(0.95, elapsed / est), eta: Math.max(0, est - elapsed) });
    }, this.tickMs);

    const rel = `${id}.${extFor(track.format)}`;
    const dest = path.join(this.tracksDir, rel);
    try {
      const { seed } = await this.client.speechToFile(
        { prompt: track.prompt, lyrics: track.lyrics, duration: track.duration, seed: track.seed, format: track.format },
        dest,
        ac.signal,
      );
      clearInterval(timer);
      await this.library.update(id, {
        status: 'done', stage: 'done', progress: 1, eta: 0,
        elapsed: (Date.now() - startedAt) / 1000,
        seed: seed ?? track.seed,
        file: rel,
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
          elapsed: (Date.now() - startedAt) / 1000,
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
