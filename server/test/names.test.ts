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
  it('never pairs an adjective with the same word as noun ("Static Static")', () => {
    // ADJECTIVES[31] = 'Static' (31.5/40), NOUNS[20] = 'Static' (20.5/40); pattern 0 = "a n"
    const seq = [31.5 / 40, 20.5 / 40, 20.5 / 40, 0];
    let i = 0;
    const t = randomTitle(() => seq[i++]);
    expect(t.split(' ')[0]).toBe('Static');
    expect(t.split(' ')[1]).not.toBe('Static');
  });
});
