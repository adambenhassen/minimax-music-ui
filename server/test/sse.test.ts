import { describe, it, expect } from 'vitest';
import { parseSse, type SseEvent } from '../src/sse.js';

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
});
const collect = async (s: ReadableStream<Uint8Array>) => { const out: SseEvent[] = []; for await (const e of parseSse(s)) out.push(e); return out; };

describe('parseSse', () => {
  it('parses events split across chunks, CRLF, comments, multi-line data', async () => {
    const out = await collect(stream(['event: progress\ndata: {"a":1}\n\n: keepalive\n\nevent: au', 'dio\r\ndata: x\r\ndata: y\r\n\r\ndata: tail\n\n']));
    expect(out).toEqual([
      { event: 'progress', data: '{"a":1}' },
      { event: 'audio', data: 'x\ny' },
      { event: 'message', data: 'tail' },
    ]);
  });
  it('emits a trailing event without final blank line', async () => {
    expect(await collect(stream(['event: done\ndata: {}']))).toEqual([{ event: 'done', data: '{}' }]);
  });
});
