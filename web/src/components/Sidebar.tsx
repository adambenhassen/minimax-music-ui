import { Gear, Library, Music, Sparkle } from './Icons';

export type View = 'create' | 'library' | 'settings';

export function Sidebar({ view, onChange, counts }: { view: View; onChange: (v: View) => void; counts: { inflight: number; total: number } }) {
  const item = (v: View, label: string, Icon: typeof Sparkle, badge?: number) => (
    <button
      onClick={() => onChange(v)}
      title={label}
      className={`relative w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2 rounded-lg text-sm transition ${view === v ? 'bg-ink-700 text-white' : 'text-zinc-400 hover:text-white hover:bg-ink-800'}`}
    >
      <Icon width={18} height={18} />
      <span className="hidden md:block flex-1 text-left">{label}</span>
      {badge ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-white absolute md:static top-0 right-0 md:top-auto md:right-auto">{badge}</span> : null}
    </button>
  );
  return (
    <aside className="w-14 md:w-56 shrink-0 h-full flex flex-col border-r border-ink-700 bg-ink-900 p-2 md:p-3 gap-1">
      <div className="flex items-center justify-center md:justify-start gap-2 px-0 md:px-2 py-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white">
          <Music width={18} height={18} />
        </div>
        <div className="hidden md:block">
          <div className="text-sm font-semibold leading-tight">MiniMax Music</div>
          <div className="text-[10px] text-zinc-500 leading-tight">Music-3 · local</div>
        </div>
      </div>
      {item('create', 'Create', Sparkle, counts.inflight)}
      {item('library', 'Library', Library, undefined)}
      <div className="mt-auto" />
      {item('settings', 'Settings', Gear, undefined)}
      <div className=" px-3 py-2 text-[11px] text-zinc-500 hidden md:block">{counts.total} track{counts.total === 1 ? '' : 's'}</div>
    </aside>
  );
}
