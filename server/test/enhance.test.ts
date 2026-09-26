import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enhancePrompt, SkillFiles } from '../src/enhance.js';
import type { LlmConfig } from '../src/types.js';
import { startFakeLlm, type FakeLlm, type FakeLlmReply } from './fakeLlm.js';

const SKILL = { 'SKILL.md': '# skill body', 'references/genre-router.md': 'ROUTER', 'templates/pop_0001.txt': 'TEMPLATE' };
const read = (p: string) => ({ name: 'read_file', args: { path: p } });
const input = { prompt: 'sad piano', lyrics: '[Verse]\nla la', instrumental: false };

let fake: FakeLlm | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

async function setup(replies: FakeLlmReply[], files: Record<string, string> = SKILL, apiKey: string | null = null) {
  fake = await startFakeLlm(replies, files);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enhance-'));
  const skill = new SkillFiles(path.join(dir, 'skill-cache'), fake.skillUrl);
  const llm: LlmConfig = { url: fake.url, apiKey, model: 'test-model' };
  return { skill, llm, dir };
}

const toolResults = (i: number) => fake!.requests[i].body.messages.filter((m) => m.role === 'tool').map((m) => m.content);

describe('enhancePrompt', () => {
  it('runs SKILL.md as the system prompt, serves read_file, returns the final caption', async () => {
    const { skill, llm } = await setup([{ toolCalls: [read('references/genre-router.md')] }, { content: '  ### Global Metadata\nslow  ' }]);
    expect(await enhancePrompt(input, llm, skill)).toBe('### Global Metadata\nslow');
    const [first, second] = fake!.requests;
    expect(first.body.model).toBe('test-model');
    expect(first.body.messages[0].role).toBe('system');
    expect(first.body.messages[0].content).toMatch(/^# skill body/);
    expect(first.body.messages[1]).toEqual({ role: 'user', content: 'Caption: sad piano\n\nLyrics:\n[Verse]\nla la' });
    expect(first.body.tools!.map((t) => t.function.name)).toEqual(['read_file']);
    expect(first.auth).toBeUndefined();
    expect(second.body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_0_0', content: 'ROUTER' });
  });

  it('sends the bearer when a key is set', async () => {
    const { skill, llm } = await setup([{ content: 'ok' }], SKILL, 'k1');
    await enhancePrompt(input, llm, skill);
    expect(fake!.requests[0].auth).toBe('Bearer k1');
  });

  it('instrumental: states the constraint and leaves lyrics out', async () => {
    const { skill, llm } = await setup([{ content: 'ok' }]);
    await enhancePrompt({ ...input, instrumental: true }, llm, skill);
    expect(fake!.requests[0].body.messages[1].content).toBe('Caption: sad piano\n\nConstraints: instrumental — no vocals.');
  });

  it('refuses paths outside the skill without fetching them', async () => {
    const { skill, llm } = await setup([
      { toolCalls: [read('../secrets.md'), read('/etc/passwd'), read('templates/a.md'), read('scripts/x.txt'), { name: 'read_file', args: 'not json' }, { name: 'shell', args: {} }] },
      { content: 'ok' },
    ]);
    await enhancePrompt(input, llm, skill);
    const results = toolResults(1);
    expect(results).toHaveLength(6);
    for (const r of results.slice(0, 4)) expect(r).toMatch(/^error: .* is not a readable skill file/);
    expect(results[4]).toMatch(/^error: arguments must be JSON/);
    expect(results[5]).toBe('error: unknown tool shell');
    expect(fake!.skillRequests).toEqual(['SKILL.md']);
  });

  it('a missing skill file is a tool error, not a failure', async () => {
    const { skill, llm } = await setup([{ toolCalls: [read('./templates/nope_0001.txt')] }, { content: 'ok' }]);
    expect(await enhancePrompt(input, llm, skill)).toBe('ok');
    expect(toolResults(1)).toEqual(['error: file not found: templates/nope_0001.txt']);
  });

  it('caches skill files across runs', async () => {
    const { skill, llm, dir } = await setup([{ toolCalls: [read('templates/pop_0001.txt')] }, { content: 'ok' }, { toolCalls: [read('templates/pop_0001.txt')] }, { content: 'ok' }]);
    await enhancePrompt(input, llm, skill);
    await enhancePrompt(input, llm, skill);
    expect(fake!.skillRequests).toEqual(['SKILL.md', 'templates/pop_0001.txt']);
    expect(toolResults(3)).toEqual(['TEMPLATE']);
    expect(await fs.readFile(path.join(dir, 'skill-cache', 'templates', 'pop_0001.txt'), 'utf8')).toBe('TEMPLATE');
  });

  it('gives up after maxRounds tool rounds', async () => {
    const { skill, llm } = await setup([{ toolCalls: [read('references/genre-router.md')] }]);
    await expect(enhancePrompt(input, llm, skill, { maxRounds: 3 })).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/did not finish within 3/) });
    expect(fake!.requests).toHaveLength(4);
  });

  it('LLM HTTP error → 502 with the upstream detail', async () => {
    const { skill, llm } = await setup([{ status: 500 }]);
    await expect(enhancePrompt(input, llm, skill)).rejects.toMatchObject({ status: 502, message: 'LLM error 500: fake llm failure' });
  });

  it('empty final answer → 502', async () => {
    const { skill, llm } = await setup([{ content: '   ' }]);
    await expect(enhancePrompt(input, llm, skill)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/empty/) });
  });

  it('timeout → 504', async () => {
    const { skill, llm } = await setup([{ content: 'late', delayMs: 500 }]);
    await expect(enhancePrompt(input, llm, skill, { timeoutMs: 50 })).rejects.toMatchObject({ status: 504 });
  });

  it('the timeout also covers skill file fetches', async () => {
    fake = await startFakeLlm([{ content: 'ok' }], SKILL, { skillDelayMs: 500 });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enhance-'));
    const skill = new SkillFiles(path.join(dir, 'skill-cache'), fake.skillUrl);
    await expect(enhancePrompt(input, { url: fake.url, apiKey: null, model: 'm' }, skill, { timeoutMs: 50 })).rejects.toMatchObject({ status: 504 });
    expect(fake.requests).toHaveLength(0);
  });

  it('unreachable LLM → 502', async () => {
    const { skill } = await setup([{ content: 'ok' }]);
    await expect(enhancePrompt(input, { url: 'http://127.0.0.1:1/v1', apiKey: null, model: 'm' }, skill)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/unreachable/) });
  });

  it('SKILL.md unavailable → 502 before calling the LLM', async () => {
    const { skill, llm } = await setup([{ content: 'ok' }], {});
    await expect(enhancePrompt(input, llm, skill)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/could not load the caption-rewriter skill/) });
    expect(fake!.requests).toHaveLength(0);
  });
});

describe('SkillFiles.isValidPath', () => {
  it('accepts only SKILL.md, references/*.md, templates/*.txt', () => {
    for (const ok of ['SKILL.md', 'references/genre-router.md', 'references/index-hip-hop-rap.md', 'templates/a-cappella-choral-pop_0001.txt']) expect(SkillFiles.isValidPath(ok)).toBe(true);
    for (const bad of ['../SKILL.md', 'README.md', 'references/../SKILL.md', 'references/x.txt', 'templates/X.txt', 'templates/sub/a.txt', 'agents/openai.yaml', '']) expect(SkillFiles.isValidPath(bad)).toBe(false);
  });
});
