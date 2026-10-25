import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => vi.restoreAllMocks());

describe('API request headers', () => {
  it('marks every fetch with X-Requested-With', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await api.health();
    await api.library();
    await api.generate({ title: 'T', prompt: 'P', lyrics: '', duration: 10, seed: null, format: 'wav', takes: 1, stream: false });
    await api.enhance({ prompt: 'P', lyrics: '', instrumental: false });
    await api.lyrics({ prompt: 'P', duration: 10 });
    await api.deleteTrack('track');
    await api.templates();
    await api.saveTemplate({ name: 'T', prompt: 'P', lyrics: '', duration: 10, format: 'wav' });
    await api.deleteTemplate('template');
    await api.settings();
    await api.saveSettings({ compat: true });
    await api.testSettings({ musicApi: 'http://localhost:7862' });

    expect(fetch).toHaveBeenCalledTimes(12);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('X-Requested-With')).toBe('XMLHttpRequest');
    }
  });
});
