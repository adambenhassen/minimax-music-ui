import { describe, it, expect } from 'vitest';
import { randomTitle } from '../src/names.js';

describe('randomTitle', () => {
  it('is deterministic for a given rng and never repeats a noun', () => {
    let i = 0;
    const seq = [0.1, 0.2, 0.2, 0.5];
    const rnd = () => seq[i++ % seq.length];
    expect(randomTitle(rnd)).toBe(randomTitle(() => seq[(i++ - 4) % seq.length]));
    for (let k = 0; k < 200; k++) {
      const t = randomTitle();
      const words = t.replace(/^The /, '').split(/ (?:&|of) | /);
      expect(t.length).toBeGreaterThan(3);
      expect(new Set(words).size).toBe(words.length);
    }
  });
});
