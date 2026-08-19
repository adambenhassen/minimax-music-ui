import { useEffect, useRef, useState } from 'react';
import { BUCKETS, loadPeaks } from '../lib/peaks';

interface Props {
  url: string;
  progress: number; // 0..1
  onSeek: (frac: number) => void;
  height?: number;
  /** 0..1 fraction of the timeline that has audio (a still-rendering track); the rest is drawn dim */
  coverage?: number;
}

export function Waveform({ url, progress, onSeek, height = 40, coverage = 1 }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const covered = Math.max(1, Math.round(BUCKETS * Math.min(1, Math.max(0, coverage))));

  useEffect(() => {
    let alive = true;
    setFailed(false);
    loadPeaks(url, covered).then((p) => alive && setPeaks(p)).catch(() => { if (alive) { setPeaks(null); setFailed(true); } });
    return () => { alive = false; };
  }, [url, covered]);

  const seek = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  const bars: (number | null)[] = peaks
    ? [...peaks, ...Array.from({ length: Math.max(0, BUCKETS - peaks.length) }, () => null)]
    : Array.from({ length: BUCKETS }, () => 0.15);
  return (
    <div ref={ref} onClick={seek} className="relative w-full cursor-pointer select-none" style={{ height }} title={failed ? 'waveform unavailable' : undefined}>
      <div className="absolute inset-0 flex items-center gap-[1px]">
        {bars.map((v, i) => {
          const frac = i / bars.length;
          const played = frac <= progress;
          const pending = v === null;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors ${!peaks ? 'bg-ink-600 animate-pulse' : pending ? 'bg-ink-700' : played ? 'bg-accent' : 'bg-ink-500'}`}
              style={{ height: `${Math.max(8, (v ?? 0.1) * 100)}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
