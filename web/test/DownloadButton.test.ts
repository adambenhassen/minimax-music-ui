import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAuthPromptHandler } from '../src/api';
import { DownloadButton } from '../src/components/DownloadButton';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: { root: Root; host: HTMLDivElement }[] = [];
let unregisterAuthHandler: (() => void) | undefined;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterEach(() => {
  unregisterAuthHandler?.();
  unregisterAuthHandler = undefined;
  for (const { root } of mountedRoots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticated downloads', () => {
  it('opens the shared auth flow on a protected download and starts it after retry', async () => {
    let authorized = false;
    let completeAuthentication!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => {
      completeAuthentication = () => { authorized = true; resolve(); };
    }));
    unregisterAuthHandler = setAuthPromptHandler(prompt);

    const requests: { url: string; method: string; authorized: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', authorized });
      return { ok: authorized, status: authorized ? 200 : 401 } as Response;
    }));

    const clickedHrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHrefs.push(this.getAttribute('href') ?? '');
    });

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    await act(async () => {
      root.render(createElement(DownloadButton, {
        url: '/api/tracks/protected/audio?download',
        className: 'btn-ghost',
        title: 'Download',
        children: 'Download',
      }));
    });

    const button = host.querySelector<HTMLButtonElement>('button')!;
    await act(async () => { button.click(); await Promise.resolve(); });
    await flush();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([{
      url: '/api/tracks/protected/audio?download', method: 'HEAD', authorized: false,
    }]);

    await act(async () => { completeAuthentication(); await Promise.resolve(); });
    await flush();

    expect(requests).toEqual([
      { url: '/api/tracks/protected/audio?download', method: 'HEAD', authorized: false },
      { url: '/api/tracks/protected/audio?download', method: 'HEAD', authorized: true },
    ]);
    expect(clickedHrefs).toEqual(['/api/tracks/protected/audio?download']);
    expect(button.disabled).toBe(false);
  });
});
