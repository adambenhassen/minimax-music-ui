const ADJECTIVES = [
  'Velvet', 'Neon', 'Paper', 'Golden', 'Hollow', 'Quiet', 'Electric', 'Midnight', 'Amber', 'Wild',
  'Silver', 'Broken', 'Distant', 'Faded', 'Crimson', 'Lonely', 'Restless', 'Tender', 'Glass', 'Slow',
  'Violet', 'Empty', 'Burning', 'Frozen', 'Sunday', 'Endless', 'Sacred', 'Little', 'Wandering', 'Cobalt',
  'Honey', 'Static', 'Pale', 'Sleepless', 'Summer', 'Winter', 'Secret', 'Northern', 'Blue', 'Last',
];
const NOUNS = [
  'Horizon', 'Rain', 'Cathedral', 'Signal', 'Rivers', 'Lanterns', 'Orbit', 'Tides', 'Weather', 'Mirrors',
  'Streets', 'Radio', 'Fires', 'Gardens', 'Ghost', 'Highway', 'Satellites', 'Harbor', 'Postcards', 'Windows',
  'Static', 'Bloom', 'Echoes', 'Motel', 'Coastline', 'Parade', 'Sunday', 'Kingdom', 'Currents', 'Sparrows',
  'Avenue', 'Comet', 'Machines', 'Lullaby', 'Cinema', 'Skyline', 'Wolves', 'Daydream', 'Voltage', 'Fable',
];
const PATTERNS: ((a: string, n: string, n2: string) => string)[] = [
  (a, n) => `${a} ${n}`,
  (a, n) => `${a} ${n}`,
  (a, n) => `${a} ${n}`,
  (_a, n, n2) => `${n} & ${n2}`,
  (a, n) => `The ${a} ${n}`,
  (_a, n, n2) => `${n} of ${n2}`,
];

const pick = <T,>(arr: T[], rnd: () => number) => arr[Math.floor(rnd() * arr.length)];

/** A random two-word song title, e.g. "Velvet Horizon". `rnd` is injectable for tests. */
export function randomTitle(rnd: () => number = Math.random): string {
  const a = pick(ADJECTIVES, rnd);
  const n = pick(NOUNS, rnd);
  let n2 = pick(NOUNS, rnd);
  if (n2 === n) n2 = NOUNS[(NOUNS.indexOf(n) + 1) % NOUNS.length];
  return pick(PATTERNS, rnd)(a, n, n2);
}
