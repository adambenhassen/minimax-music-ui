export type TrackStatus = 'queued' | 'running' | 'done' | 'error';

export interface Track {
  id: string;
  groupId: string;
  takeIndex: number;
  title: string;
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  format: string;
  status: TrackStatus;
  /** 0..1 — estimated while rendering (the API is blocking and reports no progress) */
  progress: number;
  stage: string;
  eta: number | null;
  elapsed?: number | null;
  /** seconds of audio on disk while a streamed render is running; null when the server can't stream */
  renderedSeconds: number | null;
  error: string | null;
  file: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Health {
  upstreamReachable: boolean;
  ready: boolean;
  busy: boolean;
  queued: number;
  formats: string[];
  models?: string[];
  /** optional upstream extras, e.g. "stream" (live progress + play-while-rendering) */
  capabilities?: string[];
  error?: string;
}

export interface GenerateInput {
  title: string;
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  format: string;
  takes: number;
}

export interface Template {
  id: string;
  name: string;
  prompt: string;
  lyrics: string;
  duration: number;
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

export const isInflight = (t: Track) => t.status === 'queued' || t.status === 'running';
export const isPlayable = (t: Track) => t.status === 'done' || (t.status === 'running' && (t.renderedSeconds ?? 0) > 0);
