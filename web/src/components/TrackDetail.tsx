import { useEffect } from 'react';
import { isInflight, isPlayable, type Track } from '../types';
import { coverStyle } from '../lib/cover';
import { fmtTime, fmtTook } from '../lib/format';
import { api } from '../api';
import { Download, Pause, Play, Refresh, Reuse, Spinner, Trash, X } from './Icons';
import { ProgressDetail } from './ProgressDetail';

interface Props {
  track: Track;
  groupSize: number;
  active: boolean;
  playing: boolean;
  onClose: () => void;
  onPlay: (t: Track) => void;
  onDelete: (t: Track) => void;
  onReuse: (t: Track) => void;
  onRetry: (t: Track) => void;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Suno-style side panel with everything about one track. */
export function TrackDetail({ track: t, groupSize, active, playing, onClose, onPlay, onDelete, onReuse, onRetry }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inflight = isInflight(t);
  const done = t.status === 'done';
  const err = t.status === 'error';
  const playable = isPlayable(t);
  const armed = active && playing && t.status === 'running' && (t.renderedSeconds ?? 0) === 0;
  const instrumental = t.lyrics === '[Instrumental]';

  const rows: [string, string][] = [
    ['Duration', fmtTime(t.duration)],
    ['Seed', t.seed === null ? 'random' : String(t.seed)],
    ['Format', t.format.toUpperCase()],
    ...(done && typeof t.elapsed === 'number' && t.elapsed > 0 ? [['Render time', fmtTook(t.elapsed)] as [string, string]] : []),
    ['Created', fmtDate(t.createdAt)],
    ...(t.finishedAt ? [[err ? 'Failed' : 'Finished', fmtDate(t.finishedAt)] as [string, string]] : []),
    ...(t.stream ? [['Play while rendering', 'on'] as [string, string]] : []),
  ];

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-[380px] lg:static lg:z-auto lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col bg-ink-900 border-l border-ink-700 shadow-2xl lg:shadow-none">
      <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-ink-700">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Track</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}><X width={18} height={18} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        <div className="relative rounded-2xl overflow-hidden aspect-square max-w-[300px] mx-auto" style={coverStyle(t.id)}>
          {playable && (
            <button
              onClick={() => onPlay(t)}
              className="absolute inset-0 flex items-center justify-center bg-black/25 hover:bg-black/40 transition text-white"
              aria-label={active && playing ? 'Pause' : 'Play'}
            >
              <span className="w-16 h-16 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
                {armed ? <Spinner width={28} height={28} /> : active && playing ? <Pause width={28} height={28} /> : <Play width={28} height={28} />}
              </span>
            </button>
          )}
          {inflight && (
            <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded-md bg-black/50 text-[11px] font-mono tabular-nums text-white">{Math.round(t.progress * 100)}%</span>
          )}
        </div>

        <div>
          <div className="text-lg font-semibold leading-tight break-words">{t.title}</div>
          <div className="text-xs text-zinc-500 mt-1">
            {groupSize > 1 && <>take {t.takeIndex + 1} of {groupSize} · </>}
            {inflight ? (t.status === 'queued' ? 'queued' : 'rendering') : err ? 'failed' : 'ready'}
          </div>
        </div>

        {inflight && <ProgressDetail track={t} />}
        {err && <div className="text-xs text-red-400 break-words rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">{t.error}</div>}

        <div className="flex flex-wrap items-center gap-2">
          {done && <a className="btn-ghost border border-ink-600" href={api.downloadUrl(t.id)}><Download width={16} height={16} /> Download</a>}
          <button className="btn-ghost border border-ink-600" onClick={() => onReuse(t)}><Reuse width={16} height={16} /> Reuse settings</button>
          {err && <button className="btn-ghost border border-ink-600" onClick={() => onRetry(t)}><Refresh width={16} height={16} /> Retry</button>}
          <button className="btn-ghost border border-ink-600 hover:!text-red-400" onClick={() => onDelete(t)}>
            {inflight ? <><X width={16} height={16} /> Cancel</> : <><Trash width={16} height={16} /> Delete</>}
          </button>
        </div>

        <section>
          <h3 className="label mb-1">Style</h3>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words">{t.prompt}</p>
        </section>

        <section>
          <h3 className="label mb-1">Lyrics</h3>
          {instrumental
            ? <p className="text-sm text-zinc-500 italic">Instrumental</p>
            : <pre className="p-3 rounded-lg bg-ink-950 text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">{t.lyrics}</pre>}
        </section>

        <section>
          <h3 className="label mb-1">Details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="text-zinc-300 tabular-nums text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 text-[10px] text-zinc-600 font-mono break-all select-all" title="track id">{t.id}</div>
        </section>
      </div>
    </aside>
  );
}
