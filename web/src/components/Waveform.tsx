import { useEffect, useRef, useState } from 'react';
import { loadPeaks } from '../lib/peaks';

interface Props {
  url: string;
  progress: number; // 0..1
  onSeek: (frac: number) => void;
  height?: number;
}

export function Waveform({ url, progress, onSeek, height = 40 }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setFailed(false);
    loadPeaks(url).then((p) => alive && setPeaks(p)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [url]);

  const seek = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  const bars = peaks ?? Array.from({ length: 160 }, () => 0.15);
  return (
    <div ref={ref} onClick={seek} className="relative w-full cursor-pointer select-none" style={{ height }} title={failed ? 'waveform unavailable' : undefined}>
      <div className="absolute inset-0 flex items-center gap-[1px]">
        {bars.map((v, i) => {
          const frac = i / bars.length;
          const played = frac <= progress;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors ${peaks ? (played ? 'bg-accent' : 'bg-ink-500') : 'bg-ink-600 animate-pulse'}`}
              style={{ height: `${Math.max(8, v * 100)}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
