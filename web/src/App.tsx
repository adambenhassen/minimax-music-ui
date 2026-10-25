import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, setAuthPromptHandler } from './api';
import { useHealth, useLibrary } from './hooks/usePolling';
import { isInflight, type GenerateInput, type Track } from './types';
import { Sidebar, type View } from './components/Sidebar';
import { HealthPill } from './components/HealthPill';
import { CreatePanel, DEFAULT_FORM, formFromTrack, type FormState } from './components/CreatePanel';
import { TrackFeed } from './components/TrackFeed';
import { Player } from './components/Player';
import { SettingsPanel } from './components/SettingsPanel';
import { TrackDetail } from './components/TrackDetail';

const FORM_KEY = 'minimax-music-ui.form';

function loadForm(): FormState {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    return raw ? { ...DEFAULT_FORM, ...JSON.parse(raw), mode: 'simple' } : DEFAULT_FORM; // Custom mode is disabled for now
  } catch {
    return DEFAULT_FORM;
  }
}

export default function App() {
  const [view, setView] = useState<View>('create');
  const [form, setForm] = useState<FormState>(loadForm);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const authPending = useRef<{ resolve: () => void; reject: (reason: Error) => void } | null>(null);
  const authInput = useRef<HTMLInputElement>(null);
  const authDialog = useRef<HTMLElement>(null);
  const authReturnFocus = useRef<HTMLElement | null>(null);

  const requestAuthentication = useCallback(() => new Promise<void>((resolve, reject) => {
    const activeElement = document.activeElement;
    authReturnFocus.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
    setAuthToken('');
    setAuthError(null);
    setAuthPromptOpen(true);
    authPending.current = { resolve, reject };
  }), []);

  useEffect(() => {
    const unregister = setAuthPromptHandler(requestAuthentication);
    return () => {
      unregister();
      authPending.current?.reject(new Error('Authentication prompt closed'));
      authPending.current = null;
    };
  }, [requestAuthentication]);

  const health = useHealth();
  const { tracks, error: libError, refresh, setTracks } = useLibrary();

  useEffect(() => { localStorage.setItem(FORM_KEY, JSON.stringify(form)); }, [form]);
  useEffect(() => {
    if (!authPromptOpen) {
      const target = authReturnFocus.current;
      if (target?.isConnected) target.focus();
      authReturnFocus.current = null;
      return;
    }
    authInput.current?.focus();
  }, [authPromptOpen]);

  const doneTracks = useMemo(() => tracks.filter((t) => t.status === 'done'), [tracks]);
  const active = useMemo(() => tracks.find((t) => t.id === activeId) ?? null, [tracks, activeId]);
  const selected = useMemo(() => tracks.find((t) => t.id === selectedId) ?? null, [tracks, selectedId]);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const inflight = tracks.filter(isInflight).length;

  const submitAuthToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authToken.trim() || authSubmitting) return;
    const candidate = authToken;
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      if (!await api.authenticate(candidate)) {
        setAuthError('That token is wrong. Check it and try again.');
        return;
      }
      setAuthToken('');
      const pending = authPending.current;
      authPending.current = null;
      setAuthPromptOpen(false);
      pending?.resolve();
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const cancelAuthPrompt = () => {
    const pending = authPending.current;
    authPending.current = null;
    setAuthPromptOpen(false);
    setAuthToken('');
    setAuthError(null);
    pending?.reject(new Error('Authentication canceled'));
  };

  const handleAuthKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!authSubmitting) cancelAuthPrompt();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(authDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  };

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
    if (t.id === selectedId) setSelectedId(null);
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
      selectedId={selectedId}
      playing={playing}
      onSelect={(t) => setSelectedId((cur) => (cur === t.id ? null : t.id))}
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
          {health?.demo && (
            <div className="shrink-0 px-4 md:px-6 py-1.5 text-xs text-sky-200 bg-sky-500/10 border-b border-sky-500/30 text-center">
              <span className="font-semibold">Demo</span> — a read-only showcase of tracks rendered with MiniMax-Music3. No GPU is attached: <span className="font-semibold">Create</span> simulates a render and hands you one of the showcase songs; your simulated tracks are private to this browser and vanish after a while.
              {' '}<a className="underline underline-offset-2 hover:text-white" href="https://github.com/adambenhassen/minimax-music-ui" target="_blank" rel="noreferrer">Run it yourself →</a>
            </div>
          )}
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
            <div className="flex-1 min-h-0 overflow-y-auto"><SettingsPanel onSaved={() => void refresh()} demo={!!health?.demo} /></div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-5 pt-4">
                <input className="field max-w-md" placeholder="Search title, style, lyrics…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <section className="flex-1 p-5 overflow-y-auto min-h-0">{feed}</section>
            </div>
          )}
        </main>
        {selected && view !== 'settings' && (
          <TrackDetail
            track={selected}
            groupSize={tracks.filter((t) => t.groupId === selected.groupId).length}
            active={selected.id === activeId}
            playing={playing && selected.id === activeId}
            onClose={closeDetail}
            onPlay={play}
            onDelete={remove}
            onReuse={reuse}
            onRetry={retry}
          />
        )}
      </div>
      <Player track={active} playing={playing} onPlayingChange={setPlaying} onPrev={() => step(-1)} onNext={() => step(1)} onEnded={() => step(1)} />
      {authPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4">
          <section
            ref={authDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ui-token-title"
            aria-describedby="ui-token-help"
            className="w-full max-w-[320px] rounded-lg border border-ink-700 bg-ink-900 p-6 text-zinc-100 shadow-2xl"
            onKeyDown={handleAuthKeyDown}
          >
            <h2 id="ui-token-title" className="text-base font-semibold">UI server token</h2>
            <p id="ui-token-help" className="mt-1 text-xs text-zinc-500">Enter the token configured by the UI server.</p>
            <form className="mt-4" onSubmit={(event) => void submitAuthToken(event)}>
              <label className="label mb-1 block" htmlFor="ui-token">Token</label>
              <input
                ref={authInput}
                id="ui-token"
                name="ui-token"
                type="password"
                className={`field ${authError ? 'border-red-500/70 focus:border-red-400 focus:ring-red-400/40' : ''}`}
                value={authToken}
                onChange={(event) => { setAuthToken(event.target.value); setAuthError(null); }}
                autoComplete="off"
                autoFocus
                disabled={authSubmitting}
                aria-invalid={!!authError}
                aria-describedby={authError ? 'ui-token-help ui-token-error' : 'ui-token-help'}
              />
              {authError && <p id="ui-token-error" className="mt-1 text-xs text-red-400" role="alert">{authError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={cancelAuthPrompt} disabled={authSubmitting}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!authToken.trim() || authSubmitting}>{authSubmitting ? 'Checking…' : 'Continue'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
