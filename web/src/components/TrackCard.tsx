import { useState } from 'react';
import { isInflight, isPlayable, type Track } from '../types';
import { coverStyle } from '../lib/cover';
import { fmtAgo, fmtTime, fmtTook } from '../lib/format';
import { api } from '../api';
import { Alert, Download, Pause, Play, Refresh, Reuse, Spinner, Trash, X } from './Icons';
import { ProgressDetail } from './ProgressDetail';

interface Props {
  track: Track;
  groupSize: number;
  active: boolean;
  playing: boolean;
  onPlay: (t: Track) => void;
  onDelete: (t: Track) => void;
  onReuse: (t: Track) => void;
  onRetry: (t: Track) => void;
}

export function TrackCard({ track: t, groupSize, active, playing, onPlay, onDelete, onReuse, onRetry }: Props) {
  const [open, setOpen] = useState(false);
  const inflight = isInflight(t);
  const done = t.status === 'done';
  const playable = isPlayable(t);
  const armed = active && playing && t.status === 'running' && (t.renderedSeconds ?? 0) === 0; // play pressed, no audio yet
  const err = t.status === 'error';

  return (
    <div className={`group rounded-xl border transition ${active ? 'border-accent/60 bg-ink-800' : 'border-ink-700 bg-ink-900 hover:bg-ink-800'} `}>
      <div className="flex gap-3 p-3">
        <button
          onClick={() => playable && onPlay(t)}
          disabled={!playable}
          className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden flex items-center justify-center text-white disabled:cursor-default"
          style={coverStyle(t.id)}
          aria-label={playable ? (active && playing ? 'Pause' : 'Play') : t.status}
        >
          {inflight && <span className={`absolute inset-0 bg-black/40 flex items-center justify-center text-[11px] font-mono tabular-nums ${playable ? 'group-hover:opacity-0 transition' : ''}`}>{Math.round(t.progress * 100)}%</span>}
          {playable && (
            <span className={`absolute inset-0 flex items-center justify-center bg-black/30 transition ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {armed ? <Spinner width={22} height={22} /> : active && playing ? <Pause width={22} height={22} /> : <Play width={22} height={22} />}
            </span>
          )}
          {err && <span className="absolute inset-0 bg-black/50 flex items-center justify-center text-red-300"><Alert width={20} height={20} /></span>}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-2">
                <span className="truncate">{t.title}</span>
                {groupSize > 1 ? <span className="text-[10px] text-zinc-500 shrink-0">take {t.takeIndex + 1}</span> : null}
              </div>
              <div className="text-xs text-zinc-400 truncate mt-0.5" title={t.prompt}>{t.prompt}</div>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
              {done && (
                <a className="icon-btn" href={api.downloadUrl(t.id)} title="Download"><Download width={16} height={16} /></a>
              )}
              <button className="icon-btn" title="Reuse settings" onClick={() => onReuse(t)}><Reuse width={16} height={16} /></button>
              {err && <button className="icon-btn" title="Retry" onClick={() => onRetry(t)}><Refresh width={16} height={16} /></button>}
              <button className="icon-btn hover:!text-red-400" title={inflight ? 'Cancel' : 'Delete'} onClick={() => onDelete(t)}>
                {inflight ? <X width={16} height={16} /> : <Trash width={16} height={16} />}
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500 tabular-nums">
            <span>{fmtTime(t.duration)}</span>
            {t.seed !== null && (<><span>·</span><span className="font-mono">seed {t.seed}</span></>)}
            {done && typeof t.elapsed === 'number' && t.elapsed > 0 && (<><span>·</span><span title="render time">took {fmtTook(t.elapsed)}</span></>)}
            <span>·</span>
            <span title={done ? 'finished' : 'created'}>{fmtAgo(done && t.finishedAt ? t.finishedAt : t.createdAt)}</span>
            {t.lyrics !== '[Instrumental]' && (
              <button className="ml-auto text-zinc-400 hover:text-white" onClick={() => setOpen((o) => !o)}>{open ? 'hide lyrics' : 'lyrics'}</button>
            )}
          </div>

          {inflight && <ProgressDetail track={t} />}

          {err && <div className="mt-2 text-[11px] text-red-400 break-words">{t.error}</div>}
        </div>
      </div>
      {open && (
        <pre className="mx-3 mb-3 p-3 rounded-lg bg-ink-950 text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono max-h-64 overflow-auto">{t.lyrics}</pre>
      )}
    </div>
  );
}
