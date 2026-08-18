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
  /** estimated seconds remaining */
  eta: number | null;
  /** seconds since the render started */
  elapsed?: number | null;
  error: string | null;
  file: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface GenerateRequest {
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

/** Output formats — the official /v1/audio/speech route documents wav only. */
export const FORMATS = ['wav'];
