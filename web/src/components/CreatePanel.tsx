import { useEffect, useMemo, useState } from 'react';
import type { GenerateInput, Health, Track } from '../types';
import { LyricsEditor } from './LyricsEditor';
import { TemplatesMenu, type TemplateValues } from './TemplatesMenu';
import { Chevron, Sparkle } from './Icons';
import { FORMAT_LABEL } from '../lib/format';

export const TEMPLATE_PROMPT = 'Genre: acoustic pop. BPM: 96. Key: C major. Warm and intimate, building gently into the chorus. Vocals: soft female lead, close and breathy, light stacked harmonies in the chorus. Arrangement: fingerpicked guitar and soft piano; brushed drums and upright bass enter in the chorus.';

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
  steps: string;
  format: string;
}

export const DEFAULT_FORM: FormState = {
  mode: 'simple', title: '', prompt: TEMPLATE_PROMPT, lyrics: TEMPLATE_LYRICS, instrumental: false, duration: 60, takes: 1, seed: '', steps: '', format: 'flac',
};

export function formFromTrack(t: Track): FormState {
  return {
    mode: 'custom',
    title: t.title,
    prompt: t.prompt,
    lyrics: t.lyrics === '[Instrumental]' ? '' : t.lyrics,
    instrumental: t.lyrics === '[Instrumental]',
    duration: t.duration,
    takes: 1,
    seed: t.seed === null ? '' : String(t.seed),
    steps: t.steps === null ? '' : String(t.steps),
    format: t.format,
  };
}

interface Props {
  health: Health | null;
  form: FormState;
  onFormChange: (f: FormState) => void;
  onSubmit: (input: GenerateInput) => Promise<void>;
}

export function CreatePanel({ health, form, onFormChange, onSubmit }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => onFormChange({ ...form, [k]: v });

  const formats = health?.formats?.length ? health.formats : ['wav', 'wav16', 'wav32f', 'flac', 'mp3'];
  useEffect(() => {
    if (!formats.includes(form.format)) onFormChange({ ...form, format: formats.includes('flac') ? 'flac' : formats[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.join(',')]);

  const online = !!health?.upstreamReachable;
  const canSubmit = online && form.prompt.trim().length > 0 && !submitting;
  const estMin = useMemo(() => Math.round((form.duration * 3 * form.takes) / 60 * 10) / 10, [form.duration, form.takes]);

  const submit = async () => {
    setError(null);
    const seed = form.seed.trim() === '' ? null : Number(form.seed);
    const steps = form.steps.trim() === '' ? null : Number(form.steps);
    if (seed !== null && !Number.isInteger(seed)) return setError('Seed must be an integer');
    if (steps !== null && (!Number.isInteger(steps) || steps < 10 || steps > 100)) return setError('Steps must be 10–100');
    setSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        lyrics: form.instrumental ? '[Instrumental]' : form.lyrics.trim(),
        duration: form.duration,
        seed,
        steps,
        format: form.format,
        takes: form.takes,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const modeBtn = (m: FormState['mode'], label: string) => (
    <button
      type="button"
      onClick={() => set('mode', m)}
      className={`px-3 py-1 rounded-md text-xs font-medium transition ${form.mode === m ? 'bg-ink-600 text-white' : 'text-zinc-400 hover:text-white'}`}
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
          {modeBtn('custom', 'Custom')}
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
        <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Auto-named from the description if empty" maxLength={120} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="label">{form.mode === 'simple' ? 'Song description' : 'Style of music'}</div>
          <TemplatesMenu
            builtin={{ prompt: TEMPLATE_PROMPT, lyrics: TEMPLATE_LYRICS, duration: 60, steps: null, format: 'flac' }}
            current={{
              prompt: form.prompt.trim(),
              lyrics: form.instrumental ? '[Instrumental]' : form.lyrics.trim(),
              duration: form.duration,
              steps: form.steps.trim() === '' ? null : Number(form.steps),
              format: form.format,
            }}
            onLoad={(t: TemplateValues) => onFormChange({
              ...form,
              prompt: t.prompt,
              lyrics: t.lyrics === '[Instrumental]' ? '' : t.lyrics,
              instrumental: t.lyrics === '[Instrumental]',
              duration: t.duration,
              steps: t.steps === null ? '' : String(t.steps),
              format: t.format,
            })}
          />
        </div>
        <textarea
          rows={form.mode === 'simple' ? 6 : 5}
          value={form.prompt}
          onChange={(e) => set('prompt', e.target.value)}
          className="field resize-y leading-relaxed"
          placeholder={TEMPLATE_PROMPT}
        />
      </div>

      {!form.instrumental && (
        <div>
          <div className="label mb-1">Lyrics</div>
          <LyricsEditor value={form.lyrics} onChange={(v) => set('lyrics', v)} rows={form.mode === 'simple' ? 6 : 10} />
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
          <div className="grid grid-cols-3 gap-3 mt-2">
            <div>
              <div className="label mb-1">Seed</div>
              <input className="field font-mono" inputMode="numeric" value={form.seed} onChange={(e) => set('seed', e.target.value)} placeholder="random" />
            </div>
            <div>
              <div className="label mb-1">Steps</div>
              <input className="field font-mono" inputMode="numeric" value={form.steps} onChange={(e) => set('steps', e.target.value)} placeholder="30" />
            </div>
            <div>
              <div className="label mb-1">Format</div>
              <select className="field" value={form.format} onChange={(e) => set('format', e.target.value)}>
                {formats.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f] ?? f}</option>)}
              </select>
            </div>
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
          {online ? `≈ ${estMin} min of GPU time` : health ? 'Inference server offline' : 'Connecting…'}
        </span>
      </div>
    </div>
  );
}
