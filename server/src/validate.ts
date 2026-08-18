import { FORMATS, type GenerateRequest } from './types.js';

export class ValidationError extends Error {
  status = 400;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function optInt(v: unknown, name: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new ValidationError(`${name} must be an integer`);
  return n;
}

export function normalizeGenerate(body: unknown): GenerateRequest {
  if (!body || typeof body !== 'object') throw new ValidationError('body must be an object');
  const b = body as Record<string, unknown>;

  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new ValidationError('prompt is required');

  const lyricsRaw = typeof b.lyrics === 'string' ? b.lyrics.trim() : '';
  const lyrics = lyricsRaw || '[Instrumental]';

  const durationRaw = b.duration === undefined ? 60 : Number(b.duration);
  if (!Number.isFinite(durationRaw)) throw new ValidationError('duration must be a number');
  const duration = clamp(Math.round(durationRaw), 5, 360);

  const seed = optInt(b.seed, 'seed');

  const format = typeof b.format === 'string' && b.format ? b.format : 'wav';
  if (!FORMATS.includes(format)) throw new ValidationError(`format must be one of ${FORMATS.join(', ')}`);

  const takesRaw = b.takes === undefined ? 1 : Number(b.takes);
  if (!Number.isFinite(takesRaw)) throw new ValidationError('takes must be a number');
  const takes = clamp(Math.round(takesRaw), 1, 4);

  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';

  return { title, prompt, lyrics, duration, seed, format, takes };
}
