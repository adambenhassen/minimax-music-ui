import path from 'node:path';

export interface Config {
  /** MUSIC_API from env, or null when not set (then settings.json / default apply) */
  musicApiEnv: string | null;
  /** MUSIC_API_KEY from env, or null when not set */
  apiKeyEnv: string | null;
  port: number;
  dataDir: string;
  staticDir: string | null;
  /** DEMO=1: read-only public demo (see demo.ts) */
  demo: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  return {
    musicApiEnv: env.MUSIC_API?.trim() ? env.MUSIC_API.trim().replace(/\/+$/, '') : null,
    apiKeyEnv: env.MUSIC_API_KEY?.trim() || null,
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null,
    demo: env.DEMO === '1' || env.DEMO === 'true',
  };
}
