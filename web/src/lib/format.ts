export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '';
  if (sec < 60) return `~${Math.max(1, Math.round(sec))}s left`;
  return `~${Math.round(sec / 60)} min left`;
}

export function fmtAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const FORMAT_LABEL: Record<string, string> = { wav: 'WAV', flac: 'FLAC', mp3: 'MP3' };
