import type { Track } from '../types';
import { TrackCard } from './TrackCard';
import { Music } from './Icons';

interface Props {
  tracks: Track[];
  activeId: string | null;
  selectedId: string | null;
  playing: boolean;
  onSelect: (t: Track) => void;
  onPlay: (t: Track) => void;
  onDelete: (t: Track) => void;
  onReuse: (t: Track) => void;
  onRetry: (t: Track) => void;
  emptyHint: string;
}

export function TrackFeed({ tracks, activeId, selectedId, playing, emptyHint, ...handlers }: Props) {
  if (tracks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-ink-800 flex items-center justify-center"><Music width={26} height={26} /></div>
        <div className="text-sm">{emptyHint}</div>
      </div>
    );
  }
  const groupSizes = new Map<string, number>();
  for (const t of tracks) groupSizes.set(t.groupId, (groupSizes.get(t.groupId) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-2">
      {tracks.map((t) => (
        <TrackCard key={t.id} track={t} groupSize={groupSizes.get(t.groupId) ?? 1} active={t.id === activeId} selected={t.id === selectedId} playing={playing && t.id === activeId} {...handlers} />
      ))}
    </div>
  );
}
