import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { useHealth, useLibrary } from '../src/hooks/usePolling';
import type { Health, Track } from '../src/types';

const lifecycle = vi.hoisted(() => ({
  watchUnmountedState: false,
  updatesAfterUnmount: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <State>(initialState: State | (() => State)) => {
      const [value, setValue] = actual.useState(initialState);
      const trackedSetValue: typeof setValue = (next) => {
        if (lifecycle.watchUnmountedState) lifecycle.updatesAfterUnmount += 1;
        setValue(next);
      };
      return [value, trackedSetValue] as const;
    },
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const doneTrack = (): Track => ({
  id: 'track-1',
  groupId: 'group-1',
  takeIndex: 0,
  title: 'Track',
  prompt: 'A song',
  lyrics: '',
  duration: 60,
  seed: null,
  format: 'wav',
  status: 'done',
  progress: 1,
  stage: 'done',
  eta: null,
  stream: false,
  renderedSeconds: null,
  error: null,
  file: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
});

const runningTrack = (): Track => ({ ...doneTrack(), status: 'running', stage: 'denoise', progress: 0.5, finishedAt: null });

let libraryState: ReturnType<typeof useLibrary>;
let healthState: ReturnType<typeof useHealth>;

function LibraryHarness() {
  libraryState = useLibrary();
  return null;
}

function HealthHarness({ intervalMs }: { intervalMs?: number }) {
  healthState = useHealth(intervalMs);
  return null;
}

const mountedRoots: { root: Root; mounted: boolean }[] = [];

async function mount(element: ReactNode) {
  const root = createRoot(document.createElement('div'));
  const mountState = { root, mounted: true };
  mountedRoots.push(mountState);
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    unmount() {
      if (!mountState.mounted) return;
      act(() => root.unmount());
      mountState.mounted = false;
      lifecycle.watchUnmountedState = true;
    },
  };
}

async function advanceTimersBy(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(() => {
  for (const mountState of mountedRoots.splice(0)) {
    if (mountState.mounted) act(() => mountState.root.unmount());
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  lifecycle.watchUnmountedState = false;
  lifecycle.updatesAfterUnmount = 0;
  libraryState = undefined as unknown as ReturnType<typeof useLibrary>;
  healthState = null;
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe('useLibrary', () => {
  it('fetches the library once on mount', async () => {
    const tracks = [doneTrack()];
    const library = vi.spyOn(api, 'library').mockResolvedValue(tracks);

    await mount(createElement(LibraryHarness));

    expect(library).toHaveBeenCalledTimes(1);
    expect(libraryState).toMatchObject({ tracks, error: null });
  });

  it('refetches after one second while a track is in flight', async () => {
    const library = vi.spyOn(api, 'library').mockResolvedValue([runningTrack()]);

    await mount(createElement(LibraryHarness));
    await advanceTimersBy(999);
    expect(library).toHaveBeenCalledTimes(1);

    await advanceTimersBy(1);
    expect(library).toHaveBeenCalledTimes(2);
  });

  it('refetches after ten seconds when no track is in flight', async () => {
    const library = vi.spyOn(api, 'library').mockResolvedValue([doneTrack()]);

    await mount(createElement(LibraryHarness));
    await advanceTimersBy(9999);
    expect(library).toHaveBeenCalledTimes(1);

    await advanceTimersBy(1);
    expect(library).toHaveBeenCalledTimes(2);
  });

  it('exposes a failed fetch and clears the error after the next success', async () => {
    const tracks = [doneTrack()];
    const library = vi.spyOn(api, 'library')
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(tracks);

    await mount(createElement(LibraryHarness));
    expect(libraryState.error).toBe('network unavailable');
    await advanceTimersBy(4999);
    expect(library).toHaveBeenCalledTimes(1);
    await advanceTimersBy(1);

    expect(library).toHaveBeenCalledTimes(2);
    expect(libraryState).toMatchObject({ tracks, error: null });
  });

  it('refreshes immediately and replaces the pending timer', async () => {
    const library = vi.spyOn(api, 'library').mockResolvedValue([doneTrack()]);

    await mount(createElement(LibraryHarness));
    await advanceTimersBy(4000);
    await act(async () => libraryState.refresh());

    expect(library).toHaveBeenCalledTimes(2);
    await advanceTimersBy(9999);
    expect(library).toHaveBeenCalledTimes(2);
    await advanceTimersBy(1);
    expect(library).toHaveBeenCalledTimes(3);
  });

  it('does not fetch or update state after unmount', async () => {
    let resolvePending!: (tracks: Track[]) => void;
    const library = vi.spyOn(api, 'library')
      .mockResolvedValueOnce([doneTrack()])
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));

    const mounted = await mount(createElement(LibraryHarness));
    await advanceTimersBy(10000);
    expect(library).toHaveBeenCalledTimes(2);
    mounted.unmount();

    await act(async () => {
      resolvePending([doneTrack()]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await advanceTimersBy(10000);

    expect(library).toHaveBeenCalledTimes(2);
    expect(lifecycle.updatesAfterUnmount).toBe(0);
  });

  it('does not poll after unmount with a pending timer', async () => {
    const library = vi.spyOn(api, 'library').mockResolvedValue([doneTrack()]);

    const mounted = await mount(createElement(LibraryHarness));
    expect(library).toHaveBeenCalledTimes(1);
    mounted.unmount();

    await advanceTimersBy(10000);

    expect(library).toHaveBeenCalledTimes(1);
    expect(lifecycle.updatesAfterUnmount).toBe(0);
  });
});

describe('useHealth', () => {
  const onlineHealth: Health = {
    upstreamReachable: true,
    ready: true,
    busy: false,
    queued: 0,
    formats: ['wav'],
  };

  it('fetches on mount and every polling interval', async () => {
    const health = vi.spyOn(api, 'health').mockResolvedValue(onlineHealth);

    await mount(createElement(HealthHarness, { intervalMs: 5000 }));
    expect(health).toHaveBeenCalledTimes(1);
    await advanceTimersBy(4999);
    expect(health).toHaveBeenCalledTimes(1);
    await advanceTimersBy(1);
    expect(health).toHaveBeenCalledTimes(2);
    expect(healthState).toEqual(onlineHealth);
  });

  it('uses offline health when a health call fails', async () => {
    vi.spyOn(api, 'health').mockRejectedValue(new Error('offline'));

    await mount(createElement(HealthHarness, { intervalMs: 5000 }));

    expect(healthState).toEqual({
      upstreamReachable: false,
      ready: false,
      busy: false,
      queued: 0,
      formats: ['wav'],
      error: 'ui server unreachable',
    });
  });
});
