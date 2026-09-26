import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnhanceRequest, LlmConfig } from './types.js';

/** MiniMax's music-caption-rewriter skill at a pinned commit. It ships without a license, so files are fetched on demand, not vendored. */
export const SKILL_BASE = 'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-Music3/945655064d59b98004dd70002e7eb5c8c6e11373/skills/music-caption-rewriter';

const SKILL_PATH = /^(SKILL\.md|references\/[a-z0-9][a-z0-9_-]*\.md|templates\/[a-z0-9][a-z0-9_-]*\.txt)$/;

export class EnhanceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Skill files from the local cache; a missing one is fetched once from `base` and cached. */
export class SkillFiles {
  constructor(private readonly cacheDir: string, private readonly base = SKILL_BASE) {}

  static isValidPath(p: string): boolean {
    return SKILL_PATH.test(p);
  }

  /** File text, or null when the skill has no such file. Throws when the fetch itself fails. */
  async read(rel: string, signal?: AbortSignal): Promise<string | null> {
    if (!SkillFiles.isValidPath(rel)) throw new Error(`invalid skill path: ${rel}`);
    const local = path.join(this.cacheDir, rel);
    try {
      return await fs.readFile(local, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const res = await fetch(`${this.base}/${rel}`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    await fs.mkdir(path.dirname(local), { recursive: true });
    const tmp = `${local}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, local);
    return text;
  }
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const HARNESS_NOTE = `

## Harness

You are running inside a music-generation UI. Read skill files with the read_file tool, using paths relative to the skill root (for example references/genre-router.md or templates/<id>.txt). No other tools or scripts are available. Reply with only the final caption: the three headings and their content, no preamble.`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a file of the music-caption-rewriter skill. Paths are relative to the skill root, e.g. references/genre-router.md or templates/<id>.txt.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
}];

function userMessage(input: EnhanceRequest): string {
  const parts = [`Caption: ${input.prompt}`];
  if (input.instrumental) parts.push('Constraints: instrumental — no vocals.');
  else if (input.lyrics) parts.push(`Lyrics:\n${input.lyrics}`);
  return parts.join('\n\n');
}

/** Tool failures go back to the model as text so it can recover; they never fail the request. */
async function runTool(call: ToolCall, skill: SkillFiles, signal: AbortSignal): Promise<string> {
  if (call.function.name !== 'read_file') return `error: unknown tool ${call.function.name}`;
  let p: unknown;
  try {
    p = (JSON.parse(call.function.arguments || '{}') as { path?: unknown }).path;
  } catch {
    return 'error: arguments must be JSON like {"path": "references/genre-router.md"}';
  }
  if (typeof p !== 'string') return 'error: path is required';
  const rel = p.replace(/^\.\//, '');
  if (!SkillFiles.isValidPath(rel)) return `error: ${p} is not a readable skill file (SKILL.md, references/*.md, templates/*.txt)`;
  try {
    return (await skill.read(rel, signal)) ?? `error: file not found: ${rel}`;
  } catch (err) {
    return `error: fetch failed for ${rel}: ${(err as Error).message}`;
  }
}

/** One OpenAI-compatible chat completion; failures map to EnhanceError (502, or 504 once `signal` times out). */
export async function chatComplete(llm: LlmConfig, messages: ChatMessage[], signal: AbortSignal, tools?: unknown[]): Promise<ChatMessage> {
  const failed = (err: unknown, what: string) =>
    signal.aborted ? new EnhanceError('enhancement timed out', 504) : new EnhanceError(`${what}: ${(err as Error).message}`, 502);
  let res: Response;
  try {
    res = await fetch(`${llm.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}) },
      body: JSON.stringify({ model: llm.model, messages, ...(tools ? { tools } : {}) }),
      signal,
    });
  } catch (err) {
    throw failed(err, `LLM unreachable at ${llm.url}`);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw failed(err, 'LLM response was cut off');
  }
  if (!res.ok) {
    let detail = text.slice(0, 300) || res.statusText;
    try {
      const m = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
      if (typeof m === 'string') detail = m;
    } catch { /* not JSON: keep the raw text */ }
    throw new EnhanceError(`LLM error ${res.status}: ${detail}`, 502);
  }
  let body: { choices?: { message?: ChatMessage }[] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new EnhanceError('LLM returned invalid JSON', 502);
  }
  const msg = body.choices?.[0]?.message;
  if (!msg) throw new EnhanceError('LLM response had no message', 502);
  return msg;
}

/** Rewrite a song description with MiniMax's music-caption-rewriter skill, run as a tool-calling agent on `llm`. */
export async function enhancePrompt(input: EnhanceRequest, llm: LlmConfig, skill: SkillFiles, opts: { maxRounds?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxRounds = opts.maxRounds ?? 12;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
  let skillMd: string | null;
  try {
    skillMd = await skill.read('SKILL.md', signal);
  } catch (err) {
    if (signal.aborted) throw new EnhanceError('enhancement timed out', 504);
    throw new EnhanceError(`could not load the caption-rewriter skill: ${(err as Error).message}`, 502);
  }
  if (skillMd === null) throw new EnhanceError('could not load the caption-rewriter skill: SKILL.md not found', 502);

  const messages: ChatMessage[] = [
    { role: 'system', content: skillMd + HARNESS_NOTE },
    { role: 'user', content: userMessage(input) },
  ];
  for (let round = 0; ; round++) {
    const msg = await chatComplete(llm, messages, signal, TOOLS);
    if (!msg.tool_calls?.length) {
      const caption = (msg.content ?? '').trim();
      if (!caption) throw new EnhanceError('the LLM returned an empty caption', 502);
      return caption;
    }
    if (round === maxRounds) throw new EnhanceError(`enhancement did not finish within ${maxRounds} tool rounds`, 502);
    messages.push(msg);
    for (const call of msg.tool_calls) messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call, skill, signal) });
  }
}
