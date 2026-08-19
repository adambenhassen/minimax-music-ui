export interface SseEvent { event: string; data: string }

/** Minimal text/event-stream parser: yields one event per blank-line-terminated block that has data. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const flush = function* (block: string): Generator<SseEvent> {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) yield { event, data: data.join('\n') };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      yield* flush(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
    if (done) { if (buf.trim()) yield* flush(buf); return; }
  }
}
