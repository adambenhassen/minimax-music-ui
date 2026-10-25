import { useState, type ReactNode } from 'react';
import { apiFetch } from '../api';

interface Props {
  url: string | null;
  className: string;
  title: string;
  children: ReactNode;
}

export function DownloadButton({ url, className, title, children }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    if (!url || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await apiFetch(url, { method: 'HEAD' });
      if (!response.ok) throw new Error(`download ${response.status}`);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? 'Preparing download' : failed ? 'Download failed' : title;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => { void download(); }}
        disabled={!url}
        aria-disabled={busy}
        title={label}
        aria-label={label}
        aria-busy={busy}
      >
        {children}
      </button>
      <span className="sr-only" role="status">{busy ? 'Preparing download' : failed ? 'Download failed' : ''}</span>
    </>
  );
}
