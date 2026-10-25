import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Player } from '../src/components/Player';
import type { Track } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MediaState {
  currentTime: number;
  duration: number;
  ended: boolean;
}

const mountedRoots: Root[] = [];
let mediaStates: WeakMap<HTMLMediaElement, MediaState>;
let play: ReturnType<typeof vi.fn>;
let mediaDescriptors: Map<string, PropertyDescriptor | undefined>;

function mediaState(element: HTMLMediaElement): MediaState {
  let state = mediaStates.get(element);
  if (!state) {
    state = { currentTime: 0, duration: Number.NaN, ended: false };
    mediaStates.set(element, state);
  }
  return state;
}

function setMediaState(audio: HTMLAudioElement, state: Partial<MediaState>) {
  Object.assign(mediaState(audio), state);
}

function track(id: string, status: Track['status'], renderedSeconds: number | null): Track {
  return {
    id,
    groupId: `group-${id}`,
    takeIndex: 0,
    title: `Track ${id}`,
    prompt: 'An instrumental song',
    lyrics: '',
    duration: 60,
    seed: null,
    format: 'wav',
    status,
    progress: status === 'done' ? 1 : 0.5,
    stage: status,
    eta: null,
    stream: status === 'running',
    renderedSeconds,
    error: null,
    file: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: status === 'done' ? '2026-01-01T00:01:00.000Z' : null,
  };
}

async function mount(initialTrack: Track, playing: boolean) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  const props = {
    playing,
    onPlayingChange: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onEnded: vi.fn(),
  };
  const render = async (nextTrack: Track, nextPlaying = playing) => {
    await act(async () => {
      root.render(createElement(Player, { ...props, track: nextTrack, playing: nextPlaying }));
    });
  };
  await render(initialTrack);
  return { host, audio: host.querySelector('audio')!, props, render };
}

async function dispatchMediaEvent(audio: HTMLAudioElement, type: string) {
  await act(async () => {
    audio.dispatchEvent(new Event(type));
  });
}

beforeEach(() => {
  const prototype = HTMLMediaElement.prototype;
  const properties = ['currentTime', 'duration', 'ended', 'load', 'pause', 'play'];
  mediaDescriptors = new Map(properties.map((property) => [property, Object.getOwnPropertyDescriptor(prototype, property)]));
  mediaStates = new WeakMap();

  for (const property of ['currentTime', 'duration', 'ended'] as const) {
    Object.defineProperty(prototype, property, {
      configurable: true,
      get() {
        return mediaState(this)[property];
      },
      set(value: number | boolean) {
        Object.assign(mediaState(this), { [property]: value });
      },
    });
  }

  play = vi.fn(() => Promise.resolve());
  Object.defineProperty(prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(prototype, 'pause', { configurable: true, value: vi.fn() });
  Object.defineProperty(prototype, 'load', {
    configurable: true,
    value: vi.fn(function (this: HTMLMediaElement) {
      const state = mediaState(this);
      state.currentTime = 0;
      state.ended = false;
    }),
  });

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [property, descriptor] of mediaDescriptors) {
    if (descriptor) Object.defineProperty(HTMLMediaElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLMediaElement.prototype, property);
  }
});

describe('Player live playback', () => {
  it('starts playback for a finished track', async () => {
    const { audio } = await mount(track('finished', 'done', null), true);

    expect(audio.getAttribute('src')).toBe('/api/tracks/finished/audio');
    expect(play).toHaveBeenCalled();
  });

  it('waits for more audio when live playback reaches the rendered end', async () => {
    const { audio, host, props } = await mount(track('live', 'running', 20), true);
    setMediaState(audio, { duration: 20, currentTime: 20, ended: true });

    await dispatchMediaEvent(audio, 'ended');

    expect(host.textContent).toContain('Buffering — waiting for the renderer…');
    expect(props.onEnded).not.toHaveBeenCalled();
  });

  it('resumes from 20 seconds when rendered live audio grows from 20 to 40 seconds', async () => {
    const { audio, render } = await mount(track('growing', 'running', 20), true);
    setMediaState(audio, { duration: 20, currentTime: 20, ended: true });
    await dispatchMediaEvent(audio, 'ended');
    const playCallsBeforeExpansion = play.mock.calls.length;

    await render(track('growing', 'running', 40));
    await dispatchMediaEvent(audio, 'loadedmetadata');

    expect(audio.getAttribute('src')).toBe('/api/tracks/growing/audio?r=40');
    expect(audio.currentTime).toBe(20);
    expect(play.mock.calls.length).toBeGreaterThan(playCallsBeforeExpansion);
  });

  it('swaps to the finished source and preserves the current playback position', async () => {
    const { audio, render } = await mount(track('finishing', 'running', 40), true);
    setMediaState(audio, { duration: 40 });
    audio.currentTime = 12;
    const playCallsBeforeFinish = play.mock.calls.length;

    await render(track('finishing', 'done', 40));
    await dispatchMediaEvent(audio, 'loadedmetadata');

    expect(audio.getAttribute('src')).toBe('/api/tracks/finishing/audio');
    expect(audio.currentTime).toBe(12);
    expect(play.mock.calls.length).toBeGreaterThan(playCallsBeforeFinish);
  });

  it('loads a different track from the start when the selection changes', async () => {
    const { audio, render } = await mount(track('first', 'done', null), true);
    setMediaState(audio, { duration: 60 });
    audio.currentTime = 32;

    await render(track('second', 'done', null));
    await dispatchMediaEvent(audio, 'loadedmetadata');

    expect(audio.getAttribute('src')).toBe('/api/tracks/second/audio');
    expect(audio.currentTime).toBe(0);
  });
});
