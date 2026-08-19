import { describe, it, expect } from 'vitest';
import { wavHeader, patchWavSizes, WAV_HEADER_BYTES } from '../src/wav.js';

describe('wav', () => {
  it('builds a canonical 44-byte PCM header', () => {
    const h = wavHeader(44100, 2, 1000);
    expect(h.length).toBe(WAV_HEADER_BYTES);
    expect(h.toString('ascii', 0, 4)).toBe('RIFF');
    expect(h.readUInt32LE(4)).toBe(36 + 1000);
    expect(h.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(h.readUInt16LE(20)).toBe(1);
    expect(h.readUInt16LE(22)).toBe(2);
    expect(h.readUInt32LE(24)).toBe(44100);
    expect(h.readUInt32LE(28)).toBe(44100 * 4);
    expect(h.readUInt16LE(32)).toBe(4);
    expect(h.readUInt16LE(34)).toBe(16);
    expect(h.toString('ascii', 36, 40)).toBe('data');
    expect(h.readUInt32LE(40)).toBe(1000);
  });
  it('patches sizes without mutating the input', () => {
    const h = wavHeader(44100, 2, 0);
    const p = patchWavSizes(h, 44 + 800);
    expect(p.readUInt32LE(4)).toBe(36 + 800);
    expect(p.readUInt32LE(40)).toBe(800);
    expect(h.readUInt32LE(40)).toBe(0);
  });
});
