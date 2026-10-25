import { apiFetch } from '../api';

export const BUCKETS = 160;

interface CacheEntry {
  trackUrl: string;
  sequence: number;
  finished: boolean;
  promise: Promise<number[]>;
}

const cache = new Map<string, CacheEntry>();
const latestByTrack = new Map<string, CacheEntry>();
const sequenceByTrack = new Map<string, number>();

function trackUrl(url: string) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.delete('r');
  parsed.hash = '';
  return parsed.toString();
}

/** Decode audio at `url` and return `buckets` normalised peak values (0..1), keeping one successful entry per track. */
export function loadPeaks(url: string, buckets = BUCKETS): Promise<number[]> {
  const key = `${url}#${buckets}`;
  const cached = cache.get(key);
  if (cached) return cached.promise;

  const audioUrl = trackUrl(url);
  const sequence = (sequenceByTrack.get(audioUrl) ?? 0) + 1;
  sequenceByTrack.set(audioUrl, sequence);
  const parsed = new URL(url, window.location.origin);
  const promise = (async () => {
    const res = await apiFetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error(`audio ${res.status}`);
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const audio = await ctx.decodeAudioData(buf);
      const ch0 = audio.getChannelData(0);
      const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : ch0;
      const size = Math.max(1, Math.floor(ch0.length / buckets));
      const peaks: number[] = [];
      for (let i = 0; i < buckets; i++) {
        let max = 0;
        const start = i * size;
        const end = Math.min(ch0.length, start + size);
        for (let j = start; j < end; j += 4) {
          const v = Math.max(Math.abs(ch0[j]), Math.abs(ch1[j]));
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      const top = Math.max(0.01, ...peaks);
      return peaks.map((v) => v / top);
    } finally {
      void ctx.close();
    }
  })();
  const entry: CacheEntry = { trackUrl: audioUrl, sequence, finished: !parsed.searchParams.has('r'), promise };
  cache.set(key, entry);
  promise.then(() => {
    const latest = latestByTrack.get(audioUrl);
    if ((latest?.finished && !entry.finished) || (latest && latest.sequence > sequence)) {
      if (cache.get(key) === entry) cache.delete(key);
      return;
    }
    for (const [cachedKey, cachedEntry] of cache) {
      if (cachedEntry.trackUrl === audioUrl && cachedEntry !== entry) cache.delete(cachedKey);
    }
    latestByTrack.set(audioUrl, entry);
  }, () => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return promise;
}
