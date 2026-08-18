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

export interface GenerateRequest {
  title: string;
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number | null;
  steps: number | null;
  format: string;
  takes: number;
}

export interface UpstreamHealth {
  ready: boolean;
  busy: boolean;
  queued: number;
  sampling_rate?: number;
  formats?: string[];
}

export interface UpstreamJob {
  job_id: string;
  status: TrackStatus;
  progress?: number;
  stage?: string;
  elapsed?: number;
  eta?: number | null;
  seed?: number | null;
  duration?: number;
  format?: string;
  error?: string;
  audio_url?: string;
  sampling_rate?: number;
  channels?: number;
  encoding?: string;
  peak_dbfs?: number;
  clipped?: boolean;
}

export const DEFAULT_FORMATS = ['wav', 'wav16', 'wav32f', 'flac', 'mp3'];

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
