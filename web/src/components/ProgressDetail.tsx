import type { Track } from '../types';
import { fmtEta, fmtTime } from '../lib/format';
import { parseStage, phasesFor, phaseIndex } from '../lib/stage';

export function ProgressDetail({ track: t }: { track: Track }) {
  const info = parseStage(t.stage, t.status === 'queued' ? 'queued' : 'running', t.renderedSeconds);
  const phases = phasesFor(info.real);
  const cur = phaseIndex(phases, info.phase);
  const pct = Math.round(t.progress * 100);
  const indeterminate = t.status === 'queued';

  return (
    <div className="mt-2 space-y-1.5">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px]">
        {phases.map((p, i) => {
          const state = i < cur ? 'done' : i === cur ? 'active' : 'todo';
          return (
            <li key={p.id} className="flex items-center gap-1 min-w-0">
              <span className={`px-1.5 py-0.5 rounded-md whitespace-nowrap transition ${state === 'active' ? 'bg-accent-soft text-white ring-1 ring-accent/60' : state === 'done' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                {state === 'done' ? '✓ ' : ''}{p.label}
              </span>
              {i < phases.length - 1 && <span className={`w-3 h-px ${i < cur ? 'bg-zinc-500' : 'bg-ink-600'}`} />}
            </li>
          );
        })}
      </ol>

      <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r from-accent to-purple-400 transition-[width] duration-700 ease-out ${indeterminate ? 'animate-pulseBar w-1/12' : ''}`}
          style={indeterminate ? undefined : { width: `${Math.max(2, pct)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
        <span className="truncate">{info.label}</span>
        <span className="flex flex-wrap items-center gap-x-2">
          {!indeterminate && <span className="text-zinc-300">{info.real ? '' : '~'}{pct}%</span>}
          {info.real && (t.renderedSeconds ?? 0) > 0 && <span title="audio rendered so far">{fmtTime(t.renderedSeconds!)} / {fmtTime(t.duration)} rendered</span>}
          {typeof t.elapsed === 'number' && t.elapsed > 0 && <span title="elapsed">{fmtTime(t.elapsed)} elapsed</span>}
          {t.eta !== null && t.eta > 0 && !indeterminate && <span title="estimated remaining" className="text-zinc-300">{fmtEta(t.eta)}</span>}
        </span>
      </div>
    </div>
  );
}
