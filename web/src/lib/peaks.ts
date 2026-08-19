export const BUCKETS = 160;

const cache = new Map<string, Promise<number[]>>();

/** Decode audio at `url` and return `buckets` normalised peak values (0..1). Cached per url. */
export function loadPeaks(url: string, buckets = BUCKETS): Promise<number[]> {
  const key = `${url}#${buckets}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
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
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
