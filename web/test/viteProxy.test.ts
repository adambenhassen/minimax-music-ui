import { afterEach, describe, expect, it, vi } from 'vitest';

type ProxyRequest = { setHeader: (name: string, value: string) => void };
type IncomingRequest = { method: string; headers: Record<string, string | undefined> };
type ProxyRequestHandler = (proxyReq: ProxyRequest, req: IncomingRequest) => void;

async function loadProxyRequestHandler() {
  vi.resetModules();
  vi.stubEnv('UI_TOKEN', 'test-ui-token');
  const { default: config } = await import('../vite.config');
  const options = config.server?.proxy?.['/api'];
  const configure = typeof options === 'object' ? options.configure : undefined;
  let handler: ProxyRequestHandler | undefined;
  configure?.({
    on: (_event: string, callback: unknown) => { handler = callback as ProxyRequestHandler; },
  } as unknown as Parameters<NonNullable<typeof configure>>[0], options as Parameters<NonNullable<typeof configure>>[1]);
  if (!handler) throw new Error('Vite API proxy did not register its request handler');
  return handler;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Vite API proxy authentication', () => {
  it('does not add the UI token to unsafe requests without X-Requested-With', async () => {
    const handler = await loadProxyRequestHandler();
    const setHeader = vi.fn();
    handler({ setHeader }, { method: 'POST', headers: {} });
    expect(setHeader).not.toHaveBeenCalledWith('Authorization', 'Bearer test-ui-token');
  });

  it('adds the UI token to reads and writes carrying X-Requested-With', async () => {
    const handler = await loadProxyRequestHandler();
    for (const req of [
      { method: 'GET', headers: {} },
      { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' } },
    ]) {
      const setHeader = vi.fn();
      handler({ setHeader }, req);
      expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-ui-token');
    }
  });
});
