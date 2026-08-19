import type { Health } from '../types';

export function HealthPill({ health }: { health: Health | null }) {
  let dot = 'bg-zinc-500';
  let text = 'Connecting…';
  let pulse = false;
  if (health?.demo) { dot = 'bg-sky-400'; text = 'Demo · renders are simulated'; }
  else if (health) {
    if (!health.upstreamReachable) { dot = 'bg-red-500'; text = 'Inference server offline'; }
    else if (!health.ready) { dot = 'bg-amber-400'; text = 'Loading model…'; pulse = true; }
    else if (health.busy) { dot = 'bg-accent'; text = `Rendering${health.queued ? ` · ${health.queued} queued` : ''}`; pulse = true; }
    else { dot = 'bg-emerald-400'; text = `Idle · ready${health.capabilities?.includes('stream') ? ' · live progress' : ''}`; }
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-ink-800 border border-ink-600 px-3 py-1 text-xs text-zinc-300" title={health?.error ?? ''}>
      <span className={`w-2 h-2 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} />
      {text}
    </div>
  );
}
