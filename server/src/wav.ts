export const WAV_HEADER_BYTES = 44;

/** Canonical 44-byte header for 16-bit PCM. `dataBytes` may be 0 (patched later with patchWavSizes). */
export function wavHeader(sampleRate: number, channels: number, dataBytes: number): Buffer {
  const b = Buffer.alloc(WAV_HEADER_BYTES);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

/** Copy of `header` whose RIFF/data sizes describe a file of `fileBytes` bytes. */
export function patchWavSizes(header: Buffer, fileBytes: number): Buffer {
  const h = Buffer.from(header);
  h.writeUInt32LE(Math.max(0, fileBytes - 8), 4);
  h.writeUInt32LE(Math.max(0, fileBytes - WAV_HEADER_BYTES), 40);
  return h;
}
