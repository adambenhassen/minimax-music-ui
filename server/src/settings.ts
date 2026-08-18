import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from './validate.js';

export interface StoredSettings {
  musicApi: string | null;
  apiKey: string | null;
}

export interface EnvOverrides {
  musicApi: string | null;
  apiKey: string | null;
}

export interface EffectiveUpstream {
  musicApi: string;
  apiKey: string | null;
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
    throw new ValidationError('musicApi must be a valid URL, e.g. http://100.105.185.107:7862');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('musicApi must be http or https');
  return url.toString().replace(/\/+$/, '');
}

/** Persists user-editable upstream settings; env vars always win over stored values. */
export class SettingsStore {
  private stored: StoredSettings = { musicApi: null, apiKey: null };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly env: EnvOverrides) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<StoredSettings>;
      this.stored = {
        musicApi: typeof raw.musicApi === 'string' && raw.musicApi ? raw.musicApi : null,
        apiKey: typeof raw.apiKey === 'string' && raw.apiKey ? raw.apiKey : null,
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
      source: {
        musicApi: this.env.musicApi ? 'env' : this.stored.musicApi ? 'settings' : 'default',
        apiKey: this.env.apiKey ? 'env' : this.stored.apiKey ? 'settings' : 'none',
      },
    };
  }

  /** What the UI may see: never the key itself. */
  publicView() {
    const e = this.effective();
    return {
      musicApi: e.musicApi,
      apiKeySet: !!e.apiKey,
      source: e.source,
      locked: { musicApi: this.env.musicApi !== null, apiKey: this.env.apiKey !== null },
    };
  }

  /** Update stored values. `apiKey: ""` clears it; `undefined` leaves it alone. */
  async update(patch: { musicApi?: unknown; apiKey?: unknown }): Promise<void> {
    if (patch.musicApi !== undefined) {
      if (this.env.musicApi !== null) throw new ValidationError('MUSIC_API is set in the environment and cannot be changed here');
      this.stored.musicApi = normalizeMusicApi(patch.musicApi);
    }
    if (patch.apiKey !== undefined) {
      if (this.env.apiKey !== null) throw new ValidationError('MUSIC_API_KEY is set in the environment and cannot be changed here');
      if (typeof patch.apiKey !== 'string') throw new ValidationError('apiKey must be a string');
      this.stored.apiKey = patch.apiKey.trim() || null;
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.stored, null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }
}
