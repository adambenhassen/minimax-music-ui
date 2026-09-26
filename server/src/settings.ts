import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from './validate.js';
import type { LlmConfig } from './types.js';

export interface StoredSettings {
  musicApi: string | null;
  apiKey: string | null;
  /** debug/testing: behave as if the upstream were stock sgl-omni — skip /health, never stream */
  compat: boolean;
  /** OpenAI-compatible LLM for prompt enhancement */
  llmApi: string | null;
  llmApiKey: string | null;
  llmModel: string | null;
}

export interface EnvOverrides {
  musicApi: string | null;
  apiKey: string | null;
  llmApi?: string | null;
  llmApiKey?: string | null;
  llmModel?: string | null;
}

export interface EffectiveUpstream {
  musicApi: string;
  apiKey: string | null;
  compat: boolean;
  /** where each value came from */
  source: { musicApi: 'env' | 'settings' | 'default'; apiKey: 'env' | 'settings' | 'none' };
}

export const DEFAULT_MUSIC_API = 'http://127.0.0.1:7862';


export function normalizeMusicApi(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError('musicApi is required');
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw new ValidationError('musicApi must be a valid URL, e.g. http://100.105.185.107:8000');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('musicApi must be http or https');
  return url.toString().replace(/\/+$/, '');
}

/** `""` clears the stored LLM URL. */
export function normalizeLlmApi(v: unknown): string | null {
  if (typeof v !== 'string') throw new ValidationError('llmApi must be a string');
  if (!v.trim()) return null;
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw new ValidationError('llmApi must be a valid URL, e.g. https://api.openai.com/v1');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('llmApi must be http or https');
  return url.toString().replace(/\/+$/, '');
}

const llmSource = (env: string | null | undefined, stored: string | null) => (env ? 'env' : stored ? 'settings' : 'none') as 'env' | 'settings' | 'none';

/** Persists user-editable upstream settings; env vars always win over stored values. */
export class SettingsStore {
  private stored: StoredSettings = { musicApi: null, apiKey: null, compat: false, llmApi: null, llmApiKey: null, llmModel: null };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly env: EnvOverrides) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<StoredSettings>;
      this.stored = {
        musicApi: typeof raw.musicApi === 'string' && raw.musicApi ? raw.musicApi : null,
        apiKey: typeof raw.apiKey === 'string' && raw.apiKey ? raw.apiKey : null,
        compat: raw.compat === true,
        llmApi: typeof raw.llmApi === 'string' && raw.llmApi ? raw.llmApi : null,
        llmApiKey: typeof raw.llmApiKey === 'string' && raw.llmApiKey ? raw.llmApiKey : null,
        llmModel: typeof raw.llmModel === 'string' && raw.llmModel ? raw.llmModel : null,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  effective(): EffectiveUpstream {
    const musicApi = this.env.musicApi ?? this.stored.musicApi ?? DEFAULT_MUSIC_API;
    const apiKey = this.env.apiKey ?? this.stored.apiKey;
    return {
      musicApi,
      apiKey,
      compat: this.stored.compat,
      source: {
        musicApi: this.env.musicApi ? 'env' : this.stored.musicApi ? 'settings' : 'default',
        apiKey: this.env.apiKey ? 'env' : this.stored.apiKey ? 'settings' : 'none',
      },
    };
  }

  /** The LLM used for prompt enhancement, or null until both its URL and model are set. */
  llm(): LlmConfig | null {
    const url = this.env.llmApi ?? this.stored.llmApi;
    const model = this.env.llmModel ?? this.stored.llmModel;
    if (!url || !model) return null;
    return { url, model, apiKey: this.env.llmApiKey ?? this.stored.llmApiKey };
  }

  /** What the UI may see: never the key itself. */
  publicView() {
    const e = this.effective();
    return {
      musicApi: e.musicApi,
      apiKeySet: !!e.apiKey,
      compat: e.compat,
      llmApi: this.env.llmApi ?? this.stored.llmApi,
      llmModel: this.env.llmModel ?? this.stored.llmModel,
      llmKeySet: !!(this.env.llmApiKey ?? this.stored.llmApiKey),
      source: {
        ...e.source,
        llmApi: llmSource(this.env.llmApi, this.stored.llmApi),
        llmApiKey: llmSource(this.env.llmApiKey, this.stored.llmApiKey),
        llmModel: llmSource(this.env.llmModel, this.stored.llmModel),
      },
      locked: {
        musicApi: this.env.musicApi !== null,
        apiKey: this.env.apiKey !== null,
        llmApi: this.env.llmApi != null,
        llmApiKey: this.env.llmApiKey != null,
        llmModel: this.env.llmModel != null,
      },
    };
  }

  /** Update stored values. `apiKey`/`llm*: ""` clears it; `undefined` leaves it alone. */
  async update(patch: { musicApi?: unknown; apiKey?: unknown; compat?: unknown; llmApi?: unknown; llmApiKey?: unknown; llmModel?: unknown }): Promise<void> {
    const next = { ...this.stored }; // applied only if every field validates
    if (patch.musicApi !== undefined) {
      if (this.env.musicApi !== null) throw new ValidationError('MUSIC_API is set in the environment and cannot be changed here');
      next.musicApi = normalizeMusicApi(patch.musicApi);
    }
    if (patch.apiKey !== undefined) {
      if (this.env.apiKey !== null) throw new ValidationError('MUSIC_API_KEY is set in the environment and cannot be changed here');
      if (typeof patch.apiKey !== 'string') throw new ValidationError('apiKey must be a string');
      next.apiKey = patch.apiKey.trim() || null;
    }
    if (patch.compat !== undefined) {
      if (typeof patch.compat !== 'boolean') throw new ValidationError('compat must be a boolean');
      next.compat = patch.compat;
    }
    if (patch.llmApi !== undefined) {
      if (this.env.llmApi != null) throw new ValidationError('LLM_API is set in the environment and cannot be changed here');
      next.llmApi = normalizeLlmApi(patch.llmApi);
    }
    if (patch.llmApiKey !== undefined) {
      if (this.env.llmApiKey != null) throw new ValidationError('LLM_API_KEY is set in the environment and cannot be changed here');
      if (typeof patch.llmApiKey !== 'string') throw new ValidationError('llmApiKey must be a string');
      next.llmApiKey = patch.llmApiKey.trim() || null;
    }
    if (patch.llmModel !== undefined) {
      if (this.env.llmModel != null) throw new ValidationError('LLM_MODEL is set in the environment and cannot be changed here');
      if (typeof patch.llmModel !== 'string') throw new ValidationError('llmModel must be a string');
      next.llmModel = patch.llmModel.trim() || null;
    }
    this.stored = next;
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.stored, null, 2);
    const write = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    this.writing = write.catch((err) => {
      console.error(`failed to persist ${this.file}:`, err);
    });
    return this.writing;
  }
}
