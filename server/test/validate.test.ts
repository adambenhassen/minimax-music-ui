import { describe, it, expect } from 'vitest';
import { normalizeGenerate, ValidationError } from '../src/validate.js';

describe('normalizeGenerate', () => {
  it('rejects empty prompt', () => {
    expect(() => normalizeGenerate({ prompt: '  ' })).toThrow(ValidationError);
  });
  it('defaults lyrics to [Instrumental]', () => {
    expect(normalizeGenerate({ prompt: 'x' }).lyrics).toBe('[Instrumental]');
    expect(normalizeGenerate({ prompt: 'x', lyrics: '' }).lyrics).toBe('[Instrumental]');
    expect(normalizeGenerate({ prompt: 'x', lyrics: '[Verse]\nhi' }).lyrics).toBe('[Verse]\nhi');
  });
  it('clamps duration and takes', () => {
    expect(normalizeGenerate({ prompt: 'x', duration: 400 }).duration).toBe(360);
    expect(normalizeGenerate({ prompt: 'x', duration: 1 }).duration).toBe(5);
    expect(normalizeGenerate({ prompt: 'x' }).duration).toBe(60);
    expect(normalizeGenerate({ prompt: 'x', takes: 0 }).takes).toBe(1);
    expect(normalizeGenerate({ prompt: 'x', takes: 9 }).takes).toBe(4);
    expect(normalizeGenerate({ prompt: 'x' }).stream).toBe(false);
    expect(normalizeGenerate({ prompt: 'x', stream: 'yes' }).stream).toBe(false);
    expect(normalizeGenerate({ prompt: 'x', stream: true }).stream).toBe(true);
  });
  it('validates seed', () => {
    expect(() => normalizeGenerate({ prompt: 'x', seed: 1.5 })).toThrow(/seed/);
    expect(normalizeGenerate({ prompt: 'x', seed: '' }).seed).toBeNull();
    expect(normalizeGenerate({ prompt: 'x', seed: '42' }).seed).toBe(42);
  });
  it('only wav is accepted (official route)', () => {
    expect(() => normalizeGenerate({ prompt: 'x', format: 'flac' })).toThrow(/format/);
    expect(() => normalizeGenerate({ prompt: 'x', format: 'mp3' })).toThrow(/format/);
    expect(normalizeGenerate({ prompt: 'x', format: 'wav' }).format).toBe('wav');
    expect(normalizeGenerate({ prompt: 'x' }).format).toBe('wav');
  });
});
