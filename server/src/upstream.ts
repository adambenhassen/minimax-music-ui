import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { UpstreamHealth, UpstreamJob } from './types.js';

export interface UpstreamGenerateBody {
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  steps: number | null;
  format: string;
}

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export class UpstreamClient {
  constructor(private baseUrl: string, private apiKey: string | null = null) {}

  /** Re-point the client (used when settings change at runtime). */
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

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers: this.headers(init.headers as Record<string, string>) });
    } catch (err) {
      throw new UpstreamError(`upstream unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UpstreamError(`upstream ${res.status} on ${path}: ${text.slice(0, 300)}`, res.status);
    }
    return res;
  }

  async health(): Promise<UpstreamHealth> {
    return (await this.req('/health')).json() as Promise<UpstreamHealth>;
  }

  async generate(body: UpstreamGenerateBody): Promise<{ job_id: string }> {
    const res = await this.req('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, wait: false }),
    });
    const json = (await res.json()) as { job_id?: string };
    if (!json.job_id) throw new UpstreamError('upstream /generate returned no job_id');
    return { job_id: json.job_id };
  }

  async job(id: string): Promise<UpstreamJob> {
    return (await this.req(`/jobs/${encodeURIComponent(id)}`)).json() as Promise<UpstreamJob>;
  }

  async downloadAudio(id: string, dest: string): Promise<void> {
    const res = await this.req(`/jobs/${encodeURIComponent(id)}/audio`);
    if (!res.body) throw new UpstreamError('empty audio body');
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(dest));
  }

  async cancel(id: string): Promise<void> {
    await this.req(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
