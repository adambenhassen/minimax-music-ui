import type { GenerateInput, Health, Settings, SettingsTestResult, Template, Track } from './types';

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
  health: () => fetch('/api/health').then((r) => json<Health>(r)),
  library: () => fetch('/api/library').then((r) => json<Track[]>(r)),
  generate: (input: GenerateInput) =>
    fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then((r) => json<Track[]>(r)),
  deleteTrack: (id: string) => fetch(`/api/tracks/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  templates: () => fetch('/api/templates').then((r) => json<Template[]>(r)),
  saveTemplate: (t: Omit<Template, 'id' | 'createdAt'>) =>
    fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then((r) => json<Template>(r)),
  deleteTemplate: (id: string) => fetch(`/api/templates/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  settings: () => fetch('/api/settings').then((r) => json<Settings>(r)),
  saveSettings: (patch: { musicApi?: string; apiKey?: string }) =>
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then((r) => json<Settings>(r)),
  testSettings: (candidate: { musicApi?: string; apiKey?: string }) =>
    fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) }).then((r) => json<SettingsTestResult>(r)),
  audioUrl: (id: string) => `/api/tracks/${id}/audio`,
  downloadUrl: (id: string) => `/api/tracks/${id}/audio?download`,
};
