import { chatComplete, EnhanceError } from './enhance.js';
import type { LlmConfig, LyricsRequest } from './types.js';

const SYSTEM = `You write original song lyrics for MiniMax Music 3, a text-to-music model that sings them.

Rules:
- Reply with only the lyrics: section tags on their own lines, sung lines below each. No title, notes, markdown or code fences.
- Use only these tags, spelled exactly: [Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus] [Bridge] [Instrumental] [Solo] [Outro]. [Intro], [Instrumental] and [Solo] may stand alone without sung lines.
- Fit the target length: about the number of sung lines given, in a structure that suits it. A short song is one verse and one chorus; longer songs repeat the chorus and may add a pre-chorus, bridge and outro.
- Match the description's genre, mood, story and vocal style. If it has an Arrangement section, follow its section order.
- Write in the language the description asks for; otherwise English.
- Be original: never reproduce or closely paraphrase existing lyrics, even if the description names an artist or song. Capture the style only.`;

/** Sung-line budget for a song of `duration` seconds (~5 s per line, leaving room for instrumental parts). */
export function lyricLines(duration: number): number {
  return Math.max(4, Math.round(duration / 5));
}

/** Write original lyrics for a song description, sized to its duration: one plain chat call, no tools. */
export async function writeLyrics(input: LyricsRequest, llm: LlmConfig, opts: { timeoutMs?: number } = {}): Promise<string> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
  const msg = await chatComplete(llm, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Song description:\n${input.prompt}\n\nTarget length: ${input.duration} s — about ${lyricLines(input.duration)} sung lines in total.` },
  ], signal);
  const lyrics = (msg.content ?? '').trim().replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1').trim();
  if (!lyrics) throw new EnhanceError('the LLM returned no lyrics', 502);
  return lyrics;
}
