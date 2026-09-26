import { describe, it, expect, afterEach } from 'vitest';
import { lyricLines, writeLyrics } from '../src/lyrics.js';
import { startFakeLlm, type FakeLlm, type FakeLlmReply } from './fakeLlm.js';

let fake: FakeLlm | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

const input = { prompt: 'dreamy synth-pop about a night drive', duration: 60 };
const setup = async (replies: FakeLlmReply[]) => {
  fake = await startFakeLlm(replies);
  return { url: fake.url, apiKey: null, model: 'test-model' };
};

describe('writeLyrics', () => {
  it('sends one plain chat call (no tools) with the description and a line budget', async () => {
    const llm = await setup([{ content: '  [Verse]\nNeon on the highway\n[Chorus]\nDrive  ' }]);
    expect(await writeLyrics(input, llm)).toBe('[Verse]\nNeon on the highway\n[Chorus]\nDrive');
    const { body } = fake!.requests[0];
    expect(body.model).toBe('test-model');
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('[Pre-Chorus]');
    expect(body.messages[0].content).toMatch(/never reproduce/i);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Song description:\ndreamy synth-pop about a night drive\n\nTarget length: 60 s — about 12 sung lines in total.' });
  });

  it('strips a code fence wrapped around the lyrics', async () => {
    const llm = await setup([{ content: '```text\n[Verse]\nla\n```' }]);
    expect(await writeLyrics(input, llm)).toBe('[Verse]\nla');
  });

  it('empty answer → 502', async () => {
    const llm = await setup([{ content: ' ' }]);
    await expect(writeLyrics(input, llm)).rejects.toMatchObject({ status: 502, message: 'the LLM returned no lyrics' });
  });

  it('LLM error → 502 with the reason', async () => {
    const llm = await setup([{ status: 500 }]);
    await expect(writeLyrics(input, llm)).rejects.toMatchObject({ status: 502, message: 'LLM error 500: fake llm failure' });
  });

  it('timeout → 504', async () => {
    const llm = await setup([{ content: 'late', delayMs: 500 }]);
    await expect(writeLyrics(input, llm, { timeoutMs: 50 })).rejects.toMatchObject({ status: 504 });
  });
});

describe('lyricLines', () => {
  it('scales with duration, never below 4', () => {
    expect([5, 30, 60, 180, 360].map(lyricLines)).toEqual([4, 6, 12, 36, 72]);
  });
});
