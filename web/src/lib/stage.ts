export type PhaseId = 'queued' | 'rendering' | 'download';

export const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'rendering', label: 'Rendering' },
  { id: 'download', label: 'Download' },
];

export interface StageInfo {
  phase: PhaseId;
  label: string;
}

export function parseStage(stage: string, status: 'queued' | 'running'): StageInfo {
  const s = (stage || '').toLowerCase().trim();
  if (status === 'queued') return { phase: 'queued', label: 'Waiting for the GPU — one render at a time' };
  if (s.includes('download')) return { phase: 'download', label: 'Saving render' };
  return { phase: 'rendering', label: 'Rendering — progress is estimated (~3× realtime); the server reports none' };
}

export const phaseIndex = (p: PhaseId) => PHASES.findIndex((x) => x.id === p);
