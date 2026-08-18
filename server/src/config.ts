import path from 'node:path';

export interface Config {
  musicApi: string;
  apiKey: string | null;
  port: number;
  dataDir: string;
  staticDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  return {
    musicApi: (env.MUSIC_API ?? 'http://127.0.0.1:7862').replace(/\/+$/, ''),
    apiKey: env.MUSIC_API_KEY?.trim() || null,
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null,
  };
}
