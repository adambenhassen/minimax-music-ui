import type { GenerateInput, Health, Settings, SettingsTestResult, Template, Track } from './types';

const API_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
const JSON_HEADERS = { ...API_HEADERS, 'Content-Type': 'application/json' };

type AuthPromptHandler = () => Promise<void>;

let authPromptHandler: AuthPromptHandler | null = null;
let authInProgress: Promise<void> | null = null;
let authVersion = 0;

export function setAuthPromptHandler(handler: AuthPromptHandler) {
  authPromptHandler = handler;
  return () => {
    if (authPromptHandler === handler) authPromptHandler = null;
  };
}

function requestAuthentication() {
  if (!authInProgress) {
    if (!authPromptHandler) return Promise.reject(new Error('UI authentication is required'));
    authInProgress = authPromptHandler()
      .then(() => { authVersion++; })
      .finally(() => { authInProgress = null; });
  }
  return authInProgress;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestVersion = authVersion;
  const options = { ...init, credentials: init?.credentials ?? 'same-origin' };
  const response = await fetch(input, options);
  if (response.status !== 401 || !String(input).startsWith('/api/')) return response;
  if (requestVersion === authVersion) await requestAuthentication();
  return fetch(input, options);
}

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
  authenticate: async (token: string) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: JSON_HEADERS,
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    });
    if (res.status === 401) return false;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return true;
  },
  health: () => apiFetch('/api/health', { headers: API_HEADERS }).then((r) => json<Health>(r)),
  library: () => apiFetch('/api/library', { headers: API_HEADERS }).then((r) => json<Track[]>(r)),
  generate: (input: GenerateInput) =>
    apiFetch('/api/generate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<Track[]>(r)),
  enhance: (input: { prompt: string; lyrics: string; instrumental: boolean }) =>
    apiFetch('/api/enhance', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<{ prompt: string }>(r)),
  lyrics: (input: { prompt: string; duration: number }) =>
    apiFetch('/api/lyrics', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<{ lyrics: string }>(r)),
  deleteTrack: (id: string) => apiFetch(`/api/tracks/${id}`, { method: 'DELETE', headers: API_HEADERS }).then((r) => json<{ ok: true }>(r)),
  templates: () => apiFetch('/api/templates', { headers: API_HEADERS }).then((r) => json<Template[]>(r)),
  saveTemplate: (t: Omit<Template, 'id' | 'createdAt'>) =>
    apiFetch('/api/templates', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(t) }).then((r) => json<Template>(r)),
  deleteTemplate: (id: string) => apiFetch(`/api/templates/${id}`, { method: 'DELETE', headers: API_HEADERS }).then((r) => json<{ ok: true }>(r)),
  settings: () => apiFetch('/api/settings', { headers: API_HEADERS }).then((r) => json<Settings>(r)),
  saveSettings: (patch: { musicApi?: string; apiKey?: string; compat?: boolean; llmApi?: string; llmApiKey?: string; llmModel?: string }) =>
    apiFetch('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => json<Settings>(r)),
  testSettings: (candidate: { musicApi?: string; apiKey?: string }) =>
    apiFetch('/api/settings/test', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(candidate) }).then((r) => json<SettingsTestResult>(r)),
  audioUrl: (id: string) => `/api/tracks/${id}/audio`,
  downloadUrl: (id: string) => `/api/tracks/${id}/audio?download`,
};
