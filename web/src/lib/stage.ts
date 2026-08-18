export type PhaseId = 'queued' | 'tokens' | 'diffusion' | 'decode' | 'download';

export const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'tokens', label: 'Audio tokens' },
  { id: 'diffusion', label: 'Diffusion' },
  { id: 'decode', label: 'Decode' },
  { id: 'download', label: 'Download' },
];

export interface StageInfo {
  phase: PhaseId;
  /** human label for the current stage, e.g. "Diffusion step 176 / 420" */
  label: string;
  step?: { n: number; total: number };
}

/** Map the upstream `stage` string (+ status) onto a coarse phase. */
export function parseStage(stage: string, status: 'queued' | 'running'): StageInfo {
  const s = (stage || '').toLowerCase().trim();
  const m = /step\s+(\d+)\s*\/\s*(\d+)/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const total = Number(m[2]);
    return { phase: 'diffusion', label: `Diffusion · step ${n} / ${total}`, step: { n, total } };
  }
  if (s.includes('token')) return { phase: 'tokens', label: 'Generating audio tokens' };
  if (s.includes('decod')) return { phase: 'decode', label: 'Decoding audio' };
  if (s.includes('download')) return { phase: 'download', label: 'Downloading render' };
  if (status === 'queued' || s === 'queued' || s === 'submitting' || s === '') return { phase: 'queued', label: s === 'submitting' ? 'Submitting to inference server' : 'Waiting in queue' };
  return { phase: 'tokens', label: stage };
}

export const phaseIndex = (p: PhaseId) => PHASES.findIndex((x) => x.id === p);
