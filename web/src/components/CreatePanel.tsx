import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '../api';
import type { GenerateInput, Health, Track } from '../types';
import { LyricsEditor } from './LyricsEditor';
import { TemplatesMenu, type TemplateValues } from './TemplatesMenu';
import { Chevron, Sparkle, Spinner, Wand } from './Icons';

export const TEMPLATE_PROMPT = 'Genre: acoustic pop. BPM: 96. Key: C major. Warm and intimate, building gently into the chorus. Vocals: soft female lead, close and breathy, light stacked harmonies in the chorus. Arrangement: fingerpicked guitar and soft piano; brushed drums and upright bass enter in the chorus.';

/** Only WAV is served by the official route; FLAC/MP3 stay visible but disabled. */
const FORMAT_OPTIONS = [
  { value: 'wav', label: 'WAV', disabled: false },
  { value: 'flac', label: 'FLAC (not supported by the API)', disabled: true },
  { value: 'mp3', label: 'MP3 (not supported by the API)', disabled: true },
];

export const TEMPLATE_LYRICS = `[Verse]
Morning light filtering through the pine
Every quiet street is yours and mine
[Chorus]
Softly the world begins to breathe`;

export interface FormState {
  mode: 'simple' | 'custom';
  title: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number;
  takes: number;
  seed: string;
  format: string;
  /** stream audio while rendering so the track can be played before it finishes (needs a server that advertises it) */
  stream: boolean;
}

export const DEFAULT_FORM: FormState = {
  mode: 'simple', title: '', prompt: TEMPLATE_PROMPT, lyrics: TEMPLATE_LYRICS, instrumental: false, duration: 60, takes: 1, seed: '', format: 'wav', stream: false,
};

export function formFromTrack(t: Track): FormState {
  return {
    mode: 'simple',
    title: t.title,
    prompt: t.prompt,
    lyrics: t.lyrics === '[Instrumental]' ? '' : t.lyrics,
    instrumental: t.lyrics === '[Instrumental]',
    duration: t.duration,
    takes: 1,
    seed: t.seed === null ? '' : String(t.seed),
    format: t.format,
    stream: t.stream,
  };
}

interface Props {
  health: Health | null;
  form: FormState;
  onFormChange: Dispatch<SetStateAction<FormState>>;
  onSubmit: (input: GenerateInput) => Promise<void>;
}

export function CreatePanel({ health, form, onFormChange, onSubmit }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  /** prompt before the last enhance; offered as undo while the enhanced text is untouched */
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [writingLyrics, setWritingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  /** lyrics before the last write; offered as undo while the written text is untouched */
  const [lyricsUndo, setLyricsUndo] = useState<{ before: string; after: string } | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onFormChange({ ...form, [k]: v });


  const online = !!health?.upstreamReachable;
  const loading = online && !health!.ready;
  const canSubmit = online && !loading && form.prompt.trim().length > 0 && !submitting;
  const canStream = !!health?.capabilities?.includes('stream');
  // the wands read each other's field, so they never run at once
  const canEnhance = !!health?.enhance && form.prompt.trim().length > 0 && !enhancing && !writingLyrics;
  const enhanceTitle = health?.demo ? 'Not available in the demo' : !health?.enhance ? 'Set an LLM in Settings to enhance prompts' : 'Enhance prompt with MiniMax’s caption rewriter';
  const canWriteLyrics = !!health?.enhance && form.prompt.trim().length > 0 && !writingLyrics && !enhancing;
  const lyricsTitle = health?.demo ? 'Not available in the demo' : !health?.enhance ? 'Set an LLM in Settings to write lyrics' : !form.prompt.trim() ? 'Describe the song first' : 'Write lyrics from the song description';
  const estMin = useMemo(() => Math.round((form.duration * 3 * form.takes) / 60 * 10) / 10, [form.duration, form.takes]);

  const submit = async () => {
    setError(null);
    const seed = form.seed.trim() === '' ? null : Number(form.seed);
    if (seed !== null && !Number.isInteger(seed)) return setError('Seed must be an integer');
    setSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        lyrics: form.instrumental ? '[Instrumental]' : form.lyrics.trim(),
        duration: form.duration,
        seed,
        format: form.format,
        takes: form.takes,
        stream: form.stream && canStream,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const enhance = async () => {
    setEnhanceError(null);
    setEnhancing(true);
    try {
      const before = form.prompt;
      const { prompt } = await api.enhance({ prompt: before.trim(), lyrics: form.lyrics.trim(), instrumental: form.instrumental });
      setUndo({ before, after: prompt });
      onFormChange((f) => ({ ...f, prompt }));
    } catch (err) {
      setEnhanceError((err as Error).message);
    } finally {
      setEnhancing(false);
    }
  };

  const writeLyrics = async () => {
    setLyricsError(null);
    setWritingLyrics(true);
    try {
      const before = form.lyrics;
      const { lyrics } = await api.lyrics({ prompt: form.prompt.trim(), duration: form.duration });
      setLyricsUndo({ before, after: lyrics });
      onFormChange((f) => ({ ...f, lyrics }));
    } catch (err) {
      setLyricsError((err as Error).message);
    } finally {
      setWritingLyrics(false);
    }
  };

  const modeBtn = (m: FormState['mode'], label: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? 'Coming soon' : undefined}
      onClick={() => set('mode', m)}
      className={`px-3 py-1 rounded-md text-xs font-medium transition ${form.mode === m ? 'bg-ink-600 text-white' : 'text-zinc-400 hover:text-white'} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-zinc-400`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto p-4 md:p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex bg-ink-800 border border-ink-600 rounded-lg p-0.5">
          {modeBtn('simple', 'Simple')}
          {modeBtn('custom', 'Custom', true)}
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <span>Instrumental</span>
          <span
            role="switch"
            aria-checked={form.instrumental}
            onClick={() => set('instrumental', !form.instrumental)}
            className={`relative w-9 h-5 rounded-full transition ${form.instrumental ? 'bg-accent' : 'bg-ink-600'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.instrumental ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
        </label>
      </div>

      <div>
        <div className="label mb-1">Song title <span className="text-zinc-600 normal-case tracking-normal">(optional)</span></div>
        <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Leave empty for a random name" maxLength={120} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="label">{form.mode === 'simple' ? 'Song description' : 'Style of music'}</div>
          <TemplatesMenu
            builtin={{ prompt: TEMPLATE_PROMPT, lyrics: TEMPLATE_LYRICS, duration: 60, format: 'wav' }}
            current={{
              prompt: form.prompt.trim(),
              lyrics: form.instrumental ? '[Instrumental]' : form.lyrics.trim(),
              duration: form.duration,
              format: form.format,
            }}
            onLoad={(t: TemplateValues) => onFormChange({
              ...form,
              prompt: t.prompt,
              lyrics: t.lyrics === '[Instrumental]' ? '' : t.lyrics,
              instrumental: t.lyrics === '[Instrumental]',
              duration: t.duration,
              format: t.format,
            })}
          />
        </div>
        <div className="relative">
          <textarea
            rows={form.mode === 'simple' ? 6 : 5}
            value={form.prompt}
            readOnly={enhancing}
            onChange={(e) => set('prompt', e.target.value)}
            className={`field resize-y leading-relaxed pr-10 ${enhancing ? 'opacity-60' : ''}`}
            placeholder={TEMPLATE_PROMPT}
          />
          <WandButton label="Enhance prompt" title={enhanceTitle} busy={enhancing} disabled={!canEnhance} onClick={() => void enhance()} />
        </div>
        {enhanceError && <div className="text-xs text-red-400 mt-1">Enhance failed: {enhanceError}</div>}
        {enhancing && <div className="text-[11px] text-zinc-500 mt-1">Rewriting with MiniMax’s caption rewriter… this can take a minute.</div>}
        {undo && !enhancing && form.prompt === undo.after && (
          <button type="button" className="text-[11px] text-zinc-400 hover:text-white mt-1" onClick={() => { onFormChange((f) => ({ ...f, prompt: undo.before })); setUndo(null); }}>
            Undo enhance
          </button>
        )}
      </div>

      {!form.instrumental && (
        <div>
          <div className="label mb-1">Lyrics</div>
          <LyricsEditor
            value={form.lyrics}
            onChange={(v) => set('lyrics', v)}
            rows={form.mode === 'simple' ? 6 : 10}
            readOnly={writingLyrics}
            action={<WandButton label="Write lyrics" title={lyricsTitle} busy={writingLyrics} disabled={!canWriteLyrics} onClick={() => void writeLyrics()} />}
          />
          {lyricsError && <div className="text-xs text-red-400 mt-1">Writing lyrics failed: {lyricsError}</div>}
          {writingLyrics && <div className="text-[11px] text-zinc-500 mt-1">Writing lyrics for a {form.duration}s song…</div>}
          {lyricsUndo && !writingLyrics && form.lyrics === lyricsUndo.after && (
            <button type="button" className="text-[11px] text-zinc-400 hover:text-white mt-1" onClick={() => { onFormChange((f) => ({ ...f, lyrics: lyricsUndo.before })); setLyricsUndo(null); }}>
              Undo lyrics
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between mb-1">
            <span className="label">Duration</span>
            <span className="text-xs text-zinc-300 tabular-nums">{form.duration}s</span>
          </div>
          <input type="range" min={5} max={360} step={5} value={form.duration} onChange={(e) => set('duration', Number(e.target.value))} className="w-full" />
          <div className="flex justify-between text-[10px] text-zinc-600"><span>5s</span><span>6 min</span></div>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="label">Takes</span>
            <span className="text-xs text-zinc-300 tabular-nums">{form.takes}</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" onClick={() => set('takes', n)} className={`py-1 rounded-md text-xs border transition ${form.takes === n ? 'bg-accent-soft border-accent text-white' : 'bg-ink-800 border-ink-600 text-zinc-400 hover:text-white'}`}>{n}</button>
            ))}
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">Different seed per take · rendered one at a time</div>
        </div>
      </div>

      <div>
        <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
          <Chevron width={14} height={14} className={`transition-transform ${advanced ? 'rotate-90' : ''}`} /> Advanced
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <div className="label mb-1">Seed</div>
              <input className="field font-mono" inputMode="numeric" value={form.seed} onChange={(e) => set('seed', e.target.value)} placeholder="random" />
            </div>
            <div>
              <div className="label mb-1">Format</div>
              <select className="field" value={form.format} onChange={(e) => set('format', e.target.value)} title="The official /v1/audio/speech route documents WAV only">
                {FORMAT_OPTIONS.map((f) => <option key={f.value} value={f.value} disabled={f.disabled}>{f.label}</option>)}
              </select>
            </div>
            <label className={`col-span-2 flex items-start gap-2 text-xs ${canStream ? 'text-zinc-300 cursor-pointer' : 'text-zinc-500'}`} title={canStream ? undefined : 'This server does not advertise streaming (stock sgl-omni)'}>
              <input type="checkbox" className="mt-0.5 accent-accent" checked={form.stream && canStream} disabled={!canStream} onChange={(e) => set('stream', e.target.checked)} />
              <span>
                Play while rendering
                <span className="block text-[10px] text-zinc-500">Streams audio as it's rendered so you can listen early; costs a little extra GPU time{canStream ? '' : ' — not offered by this server'}</span>
              </span>
            </label>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      </div>

      <div className="sticky bottom-0 shrink-0 px-4 md:px-5 py-4 border-t border-ink-700 bg-ink-900/90 backdrop-blur flex items-center gap-3">
        <button type="button" className="btn-primary px-5 py-2.5" disabled={!canSubmit} onClick={submit}>
          <Sparkle width={16} height={16} /> {submitting ? 'Queuing…' : form.takes > 1 ? `Create ${form.takes} takes` : 'Create'}
        </button>
        <span className="text-[11px] text-zinc-500">
          {health?.demo ? 'Demo — the render is simulated; you get a showcase song' : loading ? 'Loading model…' : online ? `≈ ${estMin} min of GPU time` : health ? 'Inference server offline' : 'Connecting…'}
        </span>
      </div>
    </div>
  );
}

function WandButton({ label, title, busy, disabled, onClick }: { label: string; title: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="absolute top-2 right-2 p-1.5 rounded-md text-zinc-400 hover:text-accent hover:bg-ink-700 transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
    >
      {busy ? <Spinner width={16} height={16} /> : <Wand width={16} height={16} />}
    </button>
  );
}
