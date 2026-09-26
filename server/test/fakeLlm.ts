import express from 'express';
import type { Server } from 'node:http';

/** One scripted /v1/chat/completions answer. The last one repeats once the script runs out. */
export interface FakeLlmReply {
  content?: string | null;
  /** `args` is JSON-encoded unless already a string (lets tests send malformed arguments) */
  toolCalls?: { name: string; args: unknown }[];
  /** answer with this HTTP status and an error body instead */
  status?: number;
  delayMs?: number;
}

export interface FakeLlmRequest {
  auth?: string;
  body: {
    model: string;
    messages: { role: string; content: string | null; tool_call_id?: string }[];
    tools: { function: { name: string } }[];
  };
}

/**
 * Fake OpenAI-compatible chat endpoint plus a fake skill source:
 * `POST {url}/chat/completions` and `GET {skillUrl}/<path>` served from `files` (404 otherwise).
 */
export interface FakeLlm {
  url: string;
  skillUrl: string;
  requests: FakeLlmRequest[];
  skillRequests: string[];
  close(): Promise<void>;
}

export async function startFakeLlm(replies: FakeLlmReply[], files: Record<string, string> = {}, opts: { skillDelayMs?: number } = {}): Promise<FakeLlm> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const requests: FakeLlmRequest[] = [];
  const skillRequests: string[] = [];
  let n = 0;

  app.post('/v1/chat/completions', (req, res) => {
    requests.push({ auth: req.headers.authorization, body: req.body });
    const r = replies[Math.min(n, replies.length - 1)];
    const id = n++;
    const send = () => {
      if (r.status) return void res.status(r.status).json({ error: { message: 'fake llm failure' } });
      const toolCalls = r.toolCalls?.map((t, i) => ({
        id: `call_${id}_${i}`, type: 'function',
        function: { name: t.name, arguments: typeof t.args === 'string' ? t.args : JSON.stringify(t.args) },
      }));
      res.json({ choices: [{ index: 0, finish_reason: toolCalls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: r.content ?? null, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }] });
    };
    if (r.delayMs) setTimeout(send, r.delayMs); else send();
  });

  app.use('/skill', (req, res) => {
    const rel = req.path.slice(1);
    skillRequests.push(rel);
    const send = () => {
      if (Object.hasOwn(files, rel)) res.type('text/plain').send(files[rel]);
      else res.status(404).send('Not Found');
    };
    if (opts.skillDelayMs) setTimeout(send, opts.skillDelayMs); else send();
  });

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  return {
    url: `${base}/v1`,
    skillUrl: `${base}/skill`,
    requests,
    skillRequests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
