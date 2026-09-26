import { useRef, type ReactNode } from 'react';

const TAGS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Instrumental'];

/** `action` renders at the textarea's top-right corner (e.g. a wand button); `readOnly` locks the text and the tag chips, and dims them. */
export function LyricsEditor({ value, onChange, rows = 10, action, readOnly = false }: { value: string; onChange: (v: string) => void; rows?: number; action?: ReactNode; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const insertTag = (tag: string) => {
    const el = ref.current;
    const text = `[${tag}]`;
    if (!el) return onChange(value ? `${value}\n${text}\n` : `${text}\n`);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const pre = before.length && !before.endsWith('\n') ? '\n' : '';
    const post = after.startsWith('\n') || after.length === 0 ? '\n' : '\n';
    const next = `${before}${pre}${text}${post}${after}`;
    onChange(next);
    const caret = before.length + pre.length + text.length + post.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TAGS.map((t) => (
          <button key={t} type="button" className="chip disabled:opacity-40" disabled={readOnly} onClick={() => insertTag(t)}>[{t}]</button>
        ))}
      </div>
      <div className="relative">
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`field font-mono text-[13px] leading-relaxed resize-y ${action ? 'pr-10' : ''} ${readOnly ? 'opacity-60' : ''}`}
          placeholder={'[Verse]\nMorning light filtering through the pine\nEvery quiet street is yours and mine\n[Chorus]\nSoftly the world begins to breathe\n\nLeave empty for an instrumental.'}
        />
        {action}
      </div>
    </div>
  );
}
