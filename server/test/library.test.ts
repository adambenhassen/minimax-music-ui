import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../src/library.js';
import type { Track } from '../src/types.js';

const mk = (id: string): Track => ({
  id, groupId: 'g', takeIndex: 0, jobId: null, title: id, prompt: 'p', lyrics: '[Instrumental]',
  duration: 60, seed: null, steps: null, format: 'wav', status: 'queued', progress: 0, stage: 'queued',
  eta: null, error: null, file: null, createdAt: new Date().toISOString(), finishedAt: null,
});

describe('Library', () => {
  it('loads empty when file missing, persists and reloads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lib-'));
    const file = path.join(dir, 'library.json');
    const lib = new Library(file);
    await lib.load();
    expect(lib.all()).toEqual([]);
    await lib.add(mk('a'));
    await lib.add(mk('b'));
    expect(lib.all().map((t) => t.id)).toEqual(['b', 'a']);
    await lib.update('a', { status: 'done', progress: 1 });
    expect(lib.get('a')?.status).toBe('done');
    const removed = await lib.remove('b');
    expect(removed?.id).toBe('b');
    const lib2 = new Library(file);
    await lib2.load();
    expect(lib2.all().map((t) => t.id)).toEqual(['a']);
    expect(await lib2.update('nope', {})).toBeUndefined();
  });
});
