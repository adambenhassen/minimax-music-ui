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
  });
  it('validates steps and seed', () => {
    expect(() => normalizeGenerate({ prompt: 'x', steps: 5 })).toThrow(/steps/);
    expect(normalizeGenerate({ prompt: 'x', steps: null }).steps).toBeNull();
    expect(normalizeGenerate({ prompt: 'x', steps: '40' }).steps).toBe(40);
    expect(() => normalizeGenerate({ prompt: 'x', seed: 1.5 })).toThrow(/seed/);
    expect(normalizeGenerate({ prompt: 'x', seed: '' }).seed).toBeNull();
  });
  it('validates format against upstream list', () => {
    expect(() => normalizeGenerate({ prompt: 'x', format: 'ogg' })).toThrow(/format/);
    expect(normalizeGenerate({ prompt: 'x', format: 'flac' }, ['flac']).format).toBe('flac');
    expect(() => normalizeGenerate({ prompt: 'x', format: 'wav' }, ['flac'])).toThrow(/format/);
  });
});
