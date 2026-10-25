import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: async () => body,
  } satisfies MockResponse as Response;
}

function successBody(url: string) {
  if (url === '/api/health') {
    return { upstreamReachable: true, ready: true, busy: false, queued: 0, formats: ['wav'] };
  }
  return [];
}

function mockApi({ validToken = 'right-token', initiallyAuthorized = false } = {}) {
  let authorized = initiallyAuthorized;
  const apiCalls: { url: string; authorized: boolean }[] = [];
  const authTokens: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth') {
      const body = JSON.parse(String(init?.body)) as { token: string };
      authTokens.push(body.token);
      if (body.token === validToken) {
        authorized = true;
        return response(204);
      }
      return response(401);
    }

    apiCalls.push({ url, authorized });
    return authorized ? response(200, successBody(url)) : response(401, { error: 'unauthorized' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { apiCalls, authTokens, fetchMock };
}

function mockDownloadApi() {
  let authorized = false;
  const authTokens: string[] = [];
  const track = {
    id: 'focus-track', groupId: 'focus-track', takeIndex: 0,
    title: 'Focus return track', prompt: 'An instrumental song', lyrics: '[Instrumental]',
    duration: 10, seed: null, format: 'wav', status: 'done', progress: 1, stage: 'done',
    eta: null, stream: false, renderedSeconds: null, error: null, file: 'focus-track.wav',
    createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z',
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth') {
      const body = JSON.parse(String(init?.body)) as { token: string };
      authTokens.push(body.token);
      authorized = body.token === 'right-token';
      return response(authorized ? 204 : 401);
    }
    if (url === '/api/tracks/focus-track/audio?download') return response(authorized ? 200 : 401);
    if (url === '/api/library') return response(200, [track]);
    return response(200, successBody(url));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { authTokens };
}

const mountedRoots: { root: Root; host: HTMLDivElement }[] = [];

async function mountApp() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push({ root, host });
  await act(async () => {
    root.render(createElement(App));
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush();
  return host;
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function enterTokenAndSubmit(host: HTMLElement, token: string) {
  const input = host.querySelector<HTMLInputElement>('input[name="ui-token"]');
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(input).not.toBeNull();
  expect(submit).not.toBeNull();

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, token);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { submit!.click(); });
  await flush();
}

function downloadButton(host: HTMLElement) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label="Download"]')).find((item) => !item.disabled);
  if (!button) throw new Error('Expected an enabled track download button');
  return button;
}

async function requestDownloadAuth(host: HTMLElement, button: HTMLButtonElement) {
  await act(async () => {
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
  });
  await flush();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
}

afterEach(() => {
  for (const { root } of mountedRoots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('UI token authentication', () => {
  it('keeps the prompt open after a wrong token and retries the original calls after success', async () => {
    const { apiCalls, authTokens } = mockApi();
    const host = await mountApp();

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await enterTokenAndSubmit(host, 'wrong-token');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('That token is wrong.');
    expect(host.querySelector<HTMLInputElement>('input[name="ui-token"]')?.value).toBe('wrong-token');

    await enterTokenAndSubmit(host, 'right-token');

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(authTokens).toEqual(['wrong-token', 'right-token']);
    expect(apiCalls.some((call) => call.authorized)).toBe(true);
    expect(apiCalls.filter((call) => call.url === '/api/library')).toHaveLength(2);
    expect(JSON.stringify(localStorage)).not.toContain('right-token');
    expect(JSON.stringify(sessionStorage)).not.toContain('right-token');
    expect(window.location.href).not.toContain('right-token');
  });

  it('uses one prompt for concurrent unauthorized API calls', async () => {
    const { apiCalls, authTokens } = mockApi();
    const host = await mountApp();

    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await enterTokenAndSubmit(host, 'right-token');

    expect(authTokens).toEqual(['right-token']);
    expect(apiCalls.filter((call) => call.url === '/api/health')).toHaveLength(2);
    expect(apiCalls.filter((call) => call.url === '/api/library')).toHaveLength(2);
    expect(apiCalls.filter((call) => call.url === '/api/templates')).toHaveLength(2);
    expect(apiCalls.every((call, index) => index < 3 || call.authorized)).toBe(true);
  });

  it('restores focus to the download button after canceling authentication', async () => {
    mockDownloadApi();
    const host = await mountApp();
    const trigger = downloadButton(host);

    await requestDownloadAuth(host, trigger);
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="dialog"] button[type="button"]')?.click(); });
    await flush();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the download button after successful authentication', async () => {
    const { authTokens } = mockDownloadApi();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const host = await mountApp();
    const trigger = downloadButton(host);

    await requestDownloadAuth(host, trigger);
    await enterTokenAndSubmit(host, 'right-token');

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(authTokens).toEqual(['right-token']);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not show a token prompt when API calls succeed without authentication', async () => {
    const { authTokens } = mockApi({ initiallyAuthorized: true });
    const host = await mountApp();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(authTokens).toEqual([]);
  });
});
