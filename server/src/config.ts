import path from 'node:path';

export interface Config {
  /** MUSIC_API from env, or null when not set (then settings.json / default apply) */
  musicApiEnv: string | null;
  /** MUSIC_API_KEY from env, or null when not set */
  apiKeyEnv: string | null;
  port: number;
  dataDir: string;
  staticDir: string | null;
  /** LLM_API / LLM_API_KEY / LLM_MODEL from env (prompt enhancement), or null when not set */
  llmApiEnv: string | null;
  llmApiKeyEnv: string | null;
  llmModelEnv: string | null;
  /** UPSTREAM_TIMEOUT_MS: max wait for a render's response (and between its chunks); 0 = no limit */
  upstreamTimeoutMs: number;
  /** DEMO=1: read-only public demo (see demo.ts) */
  demo: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? 0);
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 0) throw new Error(`Invalid UPSTREAM_TIMEOUT_MS: ${env.UPSTREAM_TIMEOUT_MS}`);
  return {
    musicApiEnv: env.MUSIC_API?.trim() ? env.MUSIC_API.trim().replace(/\/+$/, '') : null,
    apiKeyEnv: env.MUSIC_API_KEY?.trim() || null,
    llmApiEnv: env.LLM_API?.trim() ? env.LLM_API.trim().replace(/\/+$/, '') : null,
    llmApiKeyEnv: env.LLM_API_KEY?.trim() || null,
    llmModelEnv: env.LLM_MODEL?.trim() || null,
    upstreamTimeoutMs,
    port,
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null,
    demo: env.DEMO === '1' || env.DEMO === 'true',
  };
}
