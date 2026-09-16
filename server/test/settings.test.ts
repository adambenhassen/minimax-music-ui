import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../src/settings.js';

afterEach(() => vi.restoreAllMocks());

describe('SettingsStore', () => {
  it('recovers and persists after a write fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-'));
    const file = path.join(dir, 'settings.json');
    const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = new SettingsStore(file, { musicApi: null, apiKey: null });
    await settings.load();

    await expect(settings.update({ musicApi: 'http://127.0.0.1:7862' })).resolves.toBeUndefined();
    await expect(settings.update({ compat: true })).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ musicApi: 'http://127.0.0.1:7862', apiKey: null, compat: true });
  });
});
