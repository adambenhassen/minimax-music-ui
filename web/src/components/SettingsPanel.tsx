import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings, SettingsTestResult } from '../types';
import { Lock } from './Icons';

export function SettingsPanel({ onSaved, demo = false }: { onSaved: () => void; demo?: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [musicApi, setMusicApi] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [test, setTest] = useState<SettingsTestResult | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [compatMsg, setCompatMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    const s = await api.settings();
    setSettings(s);
    setMusicApi(s.musicApi);
    setApiKey('');
    setClearKey(false);
  };
  useEffect(() => { load().catch((e) => setMsg({ kind: 'err', text: (e as Error).message })); }, []);

  if (!settings) return <div className="p-6 text-sm text-zinc-500">Loading settings…</div>;

  const dirty = musicApi.trim() !== settings.musicApi || apiKey !== '' || clearKey;
  const keyPatch = () => (clearKey ? '' : apiKey.trim() ? apiKey.trim() : undefined);

  const doTest = async () => {
    setBusy('test'); setTest(null); setMsg(null);
    try {
      const patch: { musicApi?: string; apiKey?: string } = {};
      if (!settings.locked.musicApi) patch.musicApi = musicApi.trim();
      const k = keyPatch();
      if (!settings.locked.apiKey && k !== undefined) patch.apiKey = k;
      setTest(await api.testSettings(patch));
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save'); setMsg(null);
    try {
      const patch: { musicApi?: string; apiKey?: string } = {};
      if (!settings.locked.musicApi && musicApi.trim() !== settings.musicApi) patch.musicApi = musicApi.trim();
      const k = keyPatch();
      if (!settings.locked.apiKey && k !== undefined) patch.apiKey = k;
      const s = await api.saveSettings(patch);
      setSettings(s); setMusicApi(s.musicApi); setApiKey(''); setClearKey(false); setTest(null);
      setMsg({ kind: 'ok', text: 'Saved. The server now talks to the new address.' });
      onSaved();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const toggleCompat = async () => {
    setBusy('save'); setCompatMsg(null);
    try {
      const s = await api.saveSettings({ compat: !settings.compat });
      setSettings(s); setTest(null);
      setCompatMsg({ kind: 'ok', text: s.compat ? 'Compatibility mode on — the server is treated as stock sgl-omni.' : 'Compatibility mode off — server extras are used again when advertised.' });
      onSaved();
    } catch (e) {
      setCompatMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const sourceLabel = (s: string) => ({ env: 'from environment', settings: 'saved in settings', default: 'default', none: 'not set' }[s] ?? s);

  return (
    <div className="p-6 max-w-2xl space-y-8">
      {demo && <div className="text-xs rounded-lg px-3 py-2 border text-sky-200 bg-sky-500/10 border-sky-500/30">Read-only demo — settings can be viewed but not changed.</div>}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Inference server</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Where your MiniMax-Music3 server listens. Anything that speaks the standard <code className="text-zinc-300">POST /v1/audio/speech</code> route works:
          </p>
          <ul className="text-xs text-zinc-500 mt-1.5 space-y-1 list-disc list-outside pl-4">
            <li>MiniMax's own <code className="text-zinc-300">sgl-omni serve --model-path MiniMaxAI/MiniMax-Music3 --port 8000</code> → <code className="text-zinc-300">http://host:8000</code></li>
            <li>The bundled single-GPU <code className="text-zinc-300">inference/server.py</code> → <code className="text-zinc-300">http://host:7862</code> (adds live progress and play-while-rendering)</li>
          </ul>
          <p className="text-xs text-zinc-500 mt-1.5">
            A path prefix is fine — <code className="text-zinc-300">/v1/models</code> and <code className="text-zinc-300">/v1/audio/speech</code> are appended. <code className="text-zinc-300">MUSIC_API</code> / <code className="text-zinc-300">MUSIC_API_KEY</code> from the environment override and lock these fields.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label" htmlFor="musicApi">Base URL</label>
            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
              {settings.locked.musicApi && <Lock width={11} height={11} />}
              {sourceLabel(settings.source.musicApi)}
            </span>
          </div>
          <input
            id="musicApi"
            className="field font-mono disabled:opacity-60"
            value={musicApi}
            disabled={settings.locked.musicApi}
            onChange={(e) => setMusicApi(e.target.value)}
            placeholder="http://100.105.185.107:8000"
            spellCheck={false}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label" htmlFor="apiKey">API key <span className="text-zinc-600 normal-case tracking-normal">(optional)</span></label>
            <span className="text-[10px] text-zinc-500 flex items-center gap-1">
              {settings.locked.apiKey && <Lock width={11} height={11} />}
              {sourceLabel(settings.source.apiKey)}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              id="apiKey"
              type="password"
              className="field font-mono disabled:opacity-60"
              value={apiKey}
              disabled={settings.locked.apiKey || clearKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.locked.apiKey ? '•••••••• (from environment)' : settings.apiKeySet ? '•••••••• (saved — enter a new key to replace)' : 'Only if the server was started with --api-key'}
              autoComplete="off"
            />
            {settings.apiKeySet && !settings.locked.apiKey && (
              <button type="button" className={`btn-ghost text-xs shrink-0 ${clearKey ? 'bg-ink-700 text-white' : ''}`} onClick={() => { setClearKey((c) => !c); setApiKey(''); }}>
                {clearKey ? 'Will clear' : 'Clear key'}
              </button>
            )}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">Sent as <code>Authorization: Bearer …</code>. Stored in <code>data/settings.json</code>; never returned to the browser.</p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="button" className="btn-primary" disabled={busy !== null || !dirty} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn-ghost border border-ink-600" disabled={busy !== null} onClick={doTest}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          {dirty && !settings.locked.musicApi && <button type="button" className="btn-ghost text-xs" onClick={() => void load()}>Reset</button>}
        </div>

        {test && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${test.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-red-300 bg-red-500/10 border-red-500/30'}`}>
            {test.ok
              ? <>Reachable at <span className="font-mono">{test.musicApi}</span>{test.health?.models?.length ? ` · models: ${test.health.models.join(', ')}` : ''}{test.health?.formats?.length ? ` · formats: ${test.health.formats.join(', ')}` : ''}{test.health?.capabilities?.length ? ` · extras: ${test.health.capabilities.join(', ')}` : ''}</>
              : <>Could not reach <span className="font-mono">{test.musicApi}</span>: {test.error}</>}
          </div>
        )}
        {msg && <div className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-red-400'}`}>{msg.text}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Debugging</h2>
        <label className="flex items-start gap-3 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-accent" checked={settings.compat} disabled={busy !== null} onChange={() => void toggleCompat()} />
          <span>
            <span className="text-zinc-200">Compatibility mode (stock sgl-omni)</span><br />
            Ignore everything beyond the official <code className="text-zinc-300">POST /v1/audio/speech</code> contract: <code className="text-zinc-300">/health</code> is not probed, so no “Loading model” state, no live progress and no play-while-rendering — even against the bundled inference server. Useful to check that the UI still works with MiniMax's own server.
          </span>
        </label>
        {compatMsg && <div className={`text-xs ${compatMsg.kind === 'ok' ? 'text-emerald-300' : 'text-red-400'}`}>{compatMsg.text}</div>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Precedence</h2>
        <ol className="text-xs text-zinc-400 list-decimal list-inside space-y-1">
          <li><code className="text-zinc-300">MUSIC_API</code> / <code className="text-zinc-300">MUSIC_API_KEY</code> environment variables (locked above)</li>
          <li>Values saved on this page (<code className="text-zinc-300">data/settings.json</code>)</li>
          <li>Default <code className="text-zinc-300">http://127.0.0.1:7862</code></li>
        </ol>
      </section>
    </div>
  );
}
