export type PhaseId = 'queued' | 'semantic' | 'denoise' | 'download';

const ALL: { id: PhaseId; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'semantic', label: 'Generating' },
  { id: 'denoise', label: 'Rendering' },
  { id: 'download', label: 'Download' },
];

/** Estimated renders (blocking upstream) have no observable Generating stage. */
export const phasesFor = (real: boolean) => (real ? ALL : ALL.filter((p) => p.id !== 'semantic'));

export interface StageInfo {
  phase: PhaseId;
  label: string;
  /** true when the server streams real progress */
  real: boolean;
}

export function parseStage(stage: string, status: 'queued' | 'running', renderedSeconds: number | null): StageInfo {
  const s = (stage || '').toLowerCase().trim();
  if (status === 'queued') return { phase: 'queued', label: 'Waiting for the GPU — one render at a time', real: false };
  if (s === 'semantic') return { phase: 'semantic', label: 'Generating — composing the song', real: true };
  if (s === 'denoise') return { phase: 'denoise', label: renderedSeconds ? 'Rendering — you can listen now' : 'Rendering audio', real: true };
  if (s.includes('download')) return { phase: 'download', label: 'Saving render', real: false };
  return { phase: 'denoise', label: 'Rendering — progress is estimated (~3× realtime); the server reports none', real: false };
}

export const phaseIndex = (phases: { id: PhaseId }[], p: PhaseId) => phases.findIndex((x) => x.id === p);
