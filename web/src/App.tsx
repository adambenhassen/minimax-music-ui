import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useHealth, useLibrary } from './hooks/usePolling';
import { isInflight, type GenerateInput, type Track } from './types';
import { Sidebar, type View } from './components/Sidebar';
import { HealthPill } from './components/HealthPill';
import { CreatePanel, DEFAULT_FORM, formFromTrack, type FormState } from './components/CreatePanel';
import { TrackFeed } from './components/TrackFeed';
import { Player } from './components/Player';
import { SettingsPanel } from './components/SettingsPanel';

const FORM_KEY = 'minimax-music-ui.form';

function loadForm(): FormState {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    return raw ? { ...DEFAULT_FORM, ...JSON.parse(raw) } : DEFAULT_FORM;
  } catch {
    return DEFAULT_FORM;
  }
}

export default function App() {
  const [view, setView] = useState<View>('create');
  const [form, setForm] = useState<FormState>(loadForm);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const health = useHealth();
  const { tracks, error: libError, refresh, setTracks } = useLibrary();

  useEffect(() => { localStorage.setItem(FORM_KEY, JSON.stringify(form)); }, [form]);

  const doneTracks = useMemo(() => tracks.filter((t) => t.status === 'done'), [tracks]);
  const active = useMemo(() => tracks.find((t) => t.id === activeId) ?? null, [tracks, activeId]);
  const inflight = tracks.filter(isInflight).length;

  const visible = useMemo(() => {
    if (view !== 'library' || !query.trim()) return tracks;
    const q = query.toLowerCase();
    return tracks.filter((t) => t.title.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q) || t.lyrics.toLowerCase().includes(q));
  }, [tracks, view, query]);

  const submit = useCallback(async (input: GenerateInput) => {
    const created = await api.generate(input);
    setTracks((prev) => [...created, ...prev]);
    void refresh();
  }, [refresh, setTracks]);

  const play = (t: Track) => {
    if (t.id === activeId) setPlaying((p) => !p);
    else { setActiveId(t.id); setPlaying(true); }
  };

  const step = (dir: 1 | -1) => {
    if (!doneTracks.length) return;
    const idx = doneTracks.findIndex((t) => t.id === activeId);
    const next = doneTracks[(idx + dir + doneTracks.length) % doneTracks.length];
    setActiveId(next.id);
    setPlaying(true);
  };

  const remove = async (t: Track) => {
    const verb = isInflight(t) ? 'Cancel' : 'Delete';
    if (!confirm(`${verb} “${t.title}”?`)) return;
    setTracks((prev) => prev.filter((x) => x.id !== t.id));
    if (t.id === activeId) { setActiveId(null); setPlaying(false); }
    try { await api.deleteTrack(t.id); } catch (err) { alert((err as Error).message); }
    void refresh();
  };

  const reuse = (t: Track) => { setForm(formFromTrack(t)); setView('create'); };
  const retry = (t: Track) => {
    void submit({ title: t.title, prompt: t.prompt, lyrics: t.lyrics, duration: t.duration, seed: t.seed, format: t.format, takes: 1, stream: t.stream }).catch((e) => alert((e as Error).message));
  };

  const feed = (
    <TrackFeed
      tracks={visible}
      activeId={activeId}
      playing={playing}
      onPlay={play}
      onDelete={remove}
      onReuse={reuse}
      onRetry={retry}
      emptyHint={view === 'library' && query ? 'No tracks match your search.' : 'No tracks yet — describe a song and hit Create.'}
    />
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <Sidebar view={view} onChange={setView} counts={{ inflight, total: tracks.length }} />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-14 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-ink-700">
            <h1 className="text-base font-semibold truncate">{view === 'create' ? 'Create' : view === 'library' ? 'Library' : 'Settings'}</h1>
            <div className="flex items-center gap-3 shrink-0">
              {libError && <span className="text-xs text-red-400">UI server: {libError}</span>}
              {health && !health.upstreamReachable && view !== 'settings' && (
                <button className="text-xs text-red-400 hover:text-red-300 hidden md:inline underline-offset-2 hover:underline" onClick={() => setView('settings')}>Point the app at your inference server in Settings</button>
              )}
              <HealthPill health={health} />
            </div>
          </header>
          {view === 'create' ? (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[440px_1fr] overflow-y-auto lg:overflow-hidden">
              <section className="lg:border-r border-b lg:border-b-0 border-ink-700 lg:min-h-0">
                <CreatePanel health={health} form={form} onFormChange={setForm} onSubmit={submit} />
              </section>
              <section className="p-4 md:p-5 lg:overflow-y-auto lg:min-h-0">{feed}</section>
            </div>
          ) : view === 'settings' ? (
            <div className="flex-1 min-h-0 overflow-y-auto"><SettingsPanel onSaved={() => void refresh()} /></div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-5 pt-4">
                <input className="field max-w-md" placeholder="Search title, style, lyrics…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <section className="flex-1 p-5 overflow-y-auto min-h-0">{feed}</section>
            </div>
          )}
        </main>
      </div>
      <Player track={active} playing={playing} onPlayingChange={setPlaying} onPrev={() => step(-1)} onNext={() => step(1)} onEnded={() => step(1)} />
    </div>
  );
}
