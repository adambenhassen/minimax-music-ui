import type { GenerateInput, Health, Settings, SettingsTestResult, Template, Track } from './types';

const API_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
const JSON_HEADERS = { ...API_HEADERS, 'Content-Type': 'application/json' };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch('/api/health', { headers: API_HEADERS }).then((r) => json<Health>(r)),
  library: () => fetch('/api/library', { headers: API_HEADERS }).then((r) => json<Track[]>(r)),
  generate: (input: GenerateInput) =>
    fetch('/api/generate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<Track[]>(r)),
  enhance: (input: { prompt: string; lyrics: string; instrumental: boolean }) =>
    fetch('/api/enhance', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<{ prompt: string }>(r)),
  lyrics: (input: { prompt: string; duration: number }) =>
    fetch('/api/lyrics', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<{ lyrics: string }>(r)),
  deleteTrack: (id: string) => fetch(`/api/tracks/${id}`, { method: 'DELETE', headers: API_HEADERS }).then((r) => json<{ ok: true }>(r)),
  templates: () => fetch('/api/templates', { headers: API_HEADERS }).then((r) => json<Template[]>(r)),
  saveTemplate: (t: Omit<Template, 'id' | 'createdAt'>) =>
    fetch('/api/templates', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(t) }).then((r) => json<Template>(r)),
  deleteTemplate: (id: string) => fetch(`/api/templates/${id}`, { method: 'DELETE', headers: API_HEADERS }).then((r) => json<{ ok: true }>(r)),
  settings: () => fetch('/api/settings', { headers: API_HEADERS }).then((r) => json<Settings>(r)),
  saveSettings: (patch: { musicApi?: string; apiKey?: string; compat?: boolean; llmApi?: string; llmApiKey?: string; llmModel?: string }) =>
    fetch('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => json<Settings>(r)),
  testSettings: (candidate: { musicApi?: string; apiKey?: string }) =>
    fetch('/api/settings/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(candidate) }).then((r) => json<SettingsTestResult>(r)),
  audioUrl: (id: string) => `/api/tracks/${id}/audio`,
  downloadUrl: (id: string) => `/api/tracks/${id}/audio?download`,
};
