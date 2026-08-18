import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { isInflight, type Health, type Track } from '../types';

const OFFLINE_HEALTH: Health = { upstreamReachable: false, ready: false, busy: false, queued: 0, formats: ['wav', 'wav16', 'wav32f', 'flac', 'mp3'], error: 'ui server unreachable' };

export function useHealth(intervalMs = 5000) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => api.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth(OFFLINE_HEALTH));
    run();
    const t = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return health;
}

/** Polls the library: 1 s while anything is in flight, else 10 s. `refresh()` forces an immediate fetch. */
export function useLibrary() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.library();
      if (!alive.current) return;
      setTracks(list);
      setError(null);
      schedule(list.some(isInflight) ? 1000 : 10000);
    } catch (err) {
      if (!alive.current) return;
      setError((err as Error).message);
      schedule(5000);
    }
  }, [schedule]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  return { tracks, error, refresh, setTracks };
}
