import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Template } from '../types';
import { Trash } from './Icons';

export interface TemplateValues {
  prompt: string;
  lyrics: string;
  duration: number;
  format: string;
}

interface Props {
  builtin: TemplateValues;
  current: TemplateValues;
  onLoad: (t: TemplateValues) => void;
}

export function TemplatesMenu({ builtin, current, onLoad }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const refresh = () => api.templates().then(setList).catch((e) => setError((e as Error).message));

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveTemplate({ name: n, ...current });
      setName('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete template “${t.name}”?`)) return;
    try { await api.deleteTemplate(t.id); await refresh(); } catch (e) { setError((e as Error).message); }
  };

  const row = (label: string, values: TemplateValues, tpl?: Template) => (
    <div key={tpl?.id ?? '__builtin'} className="group/row flex items-center gap-1 rounded-md hover:bg-ink-700">
      <button type="button" className="flex-1 min-w-0 text-left px-2 py-1.5" onClick={() => { onLoad(values); setOpen(false); }}>
        <div className="text-xs text-zinc-200 truncate">{label}</div>
        <div className="text-[10px] text-zinc-500 truncate">{values.prompt}</div>
      </button>
      {tpl && (
        <button type="button" className="icon-btn opacity-0 group-hover/row:opacity-100 hover:!text-red-400" title="Delete template" onClick={() => remove(tpl)}>
          <Trash width={14} height={14} />
        </button>
      )}
    </div>
  );

  return (
    <div ref={box} className="relative">
      <button type="button" className="text-[11px] text-accent hover:text-accent-hover" onClick={() => setOpen((o) => !o)}>
        Templates{list.length ? ` (${list.length})` : ''} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-ink-600 bg-ink-800 shadow-2xl p-2 space-y-1">
          <div className="label px-2 pt-1">Load</div>
          {row('Default', builtin)}
          {list.map((t) => row(t.name, t, t))}
          <div className="label px-2 pt-2">Save current as</div>
          <div className="flex gap-1 px-1 pb-1">
            <input className="field !py-1 text-xs" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
            <button type="button" className="btn-primary !px-3 !py-1 text-xs" disabled={!name.trim() || saving} onClick={save}>Save</button>
          </div>
          <div className="text-[10px] text-zinc-500 px-2 pb-1">Saves style, lyrics and duration. Same name overwrites.</div>
          {error && <div className="text-[11px] text-red-400 px-2 pb-1">{error}</div>}
        </div>
      )}
    </div>
  );
}
