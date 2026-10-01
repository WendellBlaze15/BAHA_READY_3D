import { randomInt } from 'node:crypto';

/**
 * 6-character join codes. No 0/O/1/I/L so codes read cleanly aloud and on a classroom board
 * (31^6 ≈ 887M codes; lookups are rate-limited per IP so they can't be enumerated).
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Normalises what a player typed ("abc 12x" → "ABC12X"); null if it can't be a code. */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : null;
}
