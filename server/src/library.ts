import fs from 'node:fs/promises';
import path from 'node:path';
import type { Track } from './types.js';

/** Generic append-at-front JSON array store with atomic writes. */
export class JsonStore<T extends { id: string }> {
  private tracks: T[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.tracks = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.tracks = [];
        return;
      }
      throw err;
    }
  }

  all(): T[] {
    return this.tracks;
  }

  get(id: string): T | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  async add(track: T): Promise<T> {
    this.tracks.unshift(track);
    await this.persist();
    return track;
  }

  async update(id: string, patch: Partial<T>): Promise<T | undefined> {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    this.tracks[idx] = { ...this.tracks[idx], ...patch };
    await this.persist();
    return this.tracks[idx];
  }

  async remove(id: string): Promise<T | undefined> {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const [removed] = this.tracks.splice(idx, 1);
    await this.persist();
    return removed;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.tracks, null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }
}

export class Library extends JsonStore<Track> {}
