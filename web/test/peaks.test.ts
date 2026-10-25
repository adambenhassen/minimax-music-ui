import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPeaks } from '../src/lib/peaks';

let audioContextDescriptor: PropertyDescriptor | undefined;

class FakeAudioContext {
  async decodeAudioData() {
    return {
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(160).fill(0.5),
    } as unknown as AudioBuffer;
  }

  close() { return Promise.resolve(); }
}

function response(ok = true) {
  return {
    ok,
    status: ok ? 200 : 503,
    arrayBuffer: async () => new ArrayBuffer(64),
  } as Response;
}

beforeEach(() => {
  audioContextDescriptor = Object.getOwnPropertyDescriptor(window, 'AudioContext');
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (audioContextDescriptor) Object.defineProperty(window, 'AudioContext', audioContextDescriptor);
  else Reflect.deleteProperty(window, 'AudioContext');
});

describe('waveform peak cache', () => {
  it('evicts superseded partials for one track and leaves other tracks cached', async () => {
    const oldPartial = '/api/tracks/peaks-eviction/audio?r=1';
    const newerPartial = '/api/tracks/peaks-eviction/audio?r=6';
    const otherTrack = '/api/tracks/other-peaks/audio?r=1';
    let oldPartialRequests = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === oldPartial && oldPartialRequests++ > 0) return response(false);
      return response();
    });
    vi.stubGlobal('fetch', fetch);

    await loadPeaks(oldPartial, 3);
    await loadPeaks(otherTrack, 3);
    await loadPeaks(newerPartial, 6);

    await expect(loadPeaks(oldPartial, 3)).rejects.toThrow('audio 503');
    await loadPeaks(newerPartial, 6);
    await loadPeaks(otherTrack, 3);

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps only the finished waveform cached after a live track completes', async () => {
    const partial = '/api/tracks/peaks-finished/audio?r=6';
    const finished = '/api/tracks/peaks-finished/audio';
    let partialRequests = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === partial && partialRequests++ > 0) return response(false);
      return response();
    });
    vi.stubGlobal('fetch', fetch);

    await loadPeaks(partial, 16);
    await loadPeaks(finished, 160);

    await expect(loadPeaks(partial, 16)).rejects.toThrow('audio 503');
    await loadPeaks(finished, 160);

    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
