export type TrackStatus = 'queued' | 'running' | 'done' | 'error';

export interface Track {
  id: string;
  groupId: string;
  takeIndex: number;
  jobId: string | null;
  title: string;
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  steps: number | null;
  format: string;
  status: TrackStatus;
  progress: number;
  stage: string;
  eta: number | null;
  /** seconds the upstream job has been running (from /jobs/{id}) */
  elapsed?: number | null;
  error: string | null;
  file: string | null;
  createdAt: string;
  finishedAt: string | null;
  sampleRate?: number;
  channels?: number;
  encoding?: string;
  peakDbfs?: number;
  clipped?: boolean;
}

export interface Health {
  upstreamReachable: boolean;
  ready: boolean;
  busy: boolean;
  queued: number;
  sampling_rate?: number;
  formats: string[];
  error?: string;
}

export interface GenerateInput {
  title: string;
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  steps: number | null;
  format: string;
  takes: number;
}

export const isInflight = (t: Track) => t.status === 'queued' || t.status === 'running';

export interface Template {
  id: string;
  name: string;
  prompt: string;
  lyrics: string;
  duration: number;
  steps: number | null;
  format: string;
  createdAt: string;
}

export interface Settings {
  musicApi: string;
  apiKeySet: boolean;
  source: { musicApi: 'env' | 'settings' | 'default'; apiKey: 'env' | 'settings' | 'none' };
  locked: { musicApi: boolean; apiKey: boolean };
}

export interface SettingsTestResult {
  ok: boolean;
  musicApi: string;
  health?: Health;
  error?: string;
}
