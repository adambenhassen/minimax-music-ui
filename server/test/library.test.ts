import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../src/library.js';
import type { Track } from '../src/types.js';

const mk = (id: string): Track => ({
  id, groupId: 'g', takeIndex: 0, title: id, prompt: 'p', lyrics: '[Instrumental]',
  duration: 60, seed: null, format: 'wav', status: 'queued', progress: 0, stage: 'queued',
  eta: null, error: null, file: null, createdAt: new Date().toISOString(), finishedAt: null,
});

afterEach(() => vi.restoreAllMocks());

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

  it('recovers and persists after a write fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lib-'));
    const file = path.join(dir, 'library.json');
    const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lib = new Library(file);
    await lib.load();

    await expect(lib.add(mk('a'))).resolves.toMatchObject({ id: 'a' });
    await expect(lib.add(mk('b'))).resolves.toMatchObject({ id: 'b' });

    expect(error).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).map((t: Track) => t.id)).toEqual(['b', 'a']);
  });

  it('keeps render progress in memory until the next status transition', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lib-'));
    const file = path.join(dir, 'library.json');
    const lib = new Library(file);
    await lib.load();
    await lib.add(mk('a'));
    const writeFile = vi.spyOn(fs, 'writeFile');

    await lib.update('a', { status: 'running', stage: 'semantic', progress: 0 });
    await lib.update('a', { stage: 'denoise', progress: 0.6, eta: 12, elapsed: 4, renderedSeconds: 3 });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(lib.get('a')).toMatchObject({ stage: 'denoise', progress: 0.6, eta: 12, elapsed: 4, renderedSeconds: 3 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))[0]).toMatchObject({ status: 'running', stage: 'semantic', progress: 0 });

    await lib.update('a', { status: 'done', stage: 'done', progress: 1, eta: 0, elapsed: 10, renderedSeconds: null });
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))[0]).toMatchObject({ status: 'done', stage: 'done', progress: 1, eta: 0, elapsed: 10, renderedSeconds: null });
  });
});
