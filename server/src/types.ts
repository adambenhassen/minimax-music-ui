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
  /** 0..1 — real when the upstream streams progress, else estimated from elapsed time */
  progress: number;
  /** 'queued' | 'rendering' (estimated) | 'semantic' | 'denoise' (real) | 'done' | 'error' */
  stage: string;
  /** estimated seconds remaining */
  eta: number | null;
  /** seconds since the render started */
  elapsed?: number | null;
  /** opt-in: use the upstream's optional streaming extension when it advertises one */
  stream: boolean;
  /** seconds of audio already on disk while streaming; null when the server can't stream */
  renderedSeconds: number | null;
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
  stream: boolean;
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
