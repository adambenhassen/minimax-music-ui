import fs from 'node:fs/promises';
import path from 'node:path';
import type { Library } from './library.js';
import { UpstreamClient, UpstreamError } from './upstream.js';
import type { Track, UpstreamJob } from './types.js';

const EXT: Record<string, string> = { wav: 'wav', wav16: 'wav', wav32f: 'wav', flac: 'flac', mp3: 'mp3' };
export const extFor = (format: string) => EXT[format] ?? format;

export class Poller {
  private timer: NodeJS.Timeout | null = null;
  private inflightTick: Promise<void> | null = null;
  upstreamReachable = true;

  constructor(
    private readonly library: Library,
    private readonly upstream: UpstreamClient,
    private readonly tracksDir: string,
    private readonly intervalMs = 1000,
    private readonly log: (msg: string) => void = (m) => console.log(`[poller] ${m}`),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over all in-flight tracks. Concurrent callers share the in-progress pass. */
  tick(): Promise<void> {
    if (this.inflightTick) return this.inflightTick;
    this.inflightTick = this.pass().finally(() => { this.inflightTick = null; });
    return this.inflightTick;
  }

  private async pass(): Promise<void> {
    const inflight = this.library.all().filter((t) => t.status === 'queued' || t.status === 'running');
    for (const track of inflight) await this.poll(track);
  }

  private async poll(track: Track): Promise<void> {
    if (!track.jobId) {
      await this.library.update(track.id, { status: 'error', error: 'no upstream job id', stage: 'error' });
      return;
    }
    let job: UpstreamJob;
    try {
      job = await this.upstream.job(track.jobId);
      this.upstreamReachable = true;
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) {
        await this.library.update(track.id, { status: 'error', error: 'job vanished upstream', stage: 'error' });
        return;
      }
      this.upstreamReachable = false;
      this.log(`poll ${track.jobId} failed: ${(err as Error).message}`);
      return;
    }

    const base: Partial<Track> = {
      progress: typeof job.progress === 'number' ? job.progress : track.progress,
      stage: job.stage ?? track.stage,
      eta: typeof job.eta === 'number' ? job.eta : null,
      seed: typeof job.seed === 'number' ? job.seed : track.seed,
    };

    switch (job.status) {
      case 'queued':
      case 'running':
        await this.library.update(track.id, { ...base, status: job.status });
        return;
      case 'error':
        await this.library.update(track.id, { ...base, status: 'error', error: job.error ?? 'upstream error', stage: 'error', finishedAt: new Date().toISOString() });
        return;
      case 'done': {
        await this.library.update(track.id, { ...base, status: 'running', stage: 'downloading', progress: 1 });
        const rel = `${track.id}.${extFor(track.format)}`;
        const dest = path.join(this.tracksDir, rel);
        try {
          await fs.mkdir(this.tracksDir, { recursive: true });
          await this.upstream.downloadAudio(track.jobId, dest);
        } catch (err) {
          this.log(`download ${track.jobId} failed: ${(err as Error).message}`);
          await this.library.update(track.id, { status: 'error', error: `download failed: ${(err as Error).message}`, stage: 'error' });
          return;
        }
        await this.library.update(track.id, {
          status: 'done',
          stage: 'done',
          progress: 1,
          eta: 0,
          file: rel,
          finishedAt: new Date().toISOString(),
          sampleRate: job.sampling_rate,
          channels: job.channels,
          encoding: job.encoding,
          peakDbfs: job.peak_dbfs,
          clipped: job.clipped,
        });
        return;
      }
      default:
        this.log(`unknown status ${(job as { status: string }).status} for ${track.jobId}`);
    }
  }
}
