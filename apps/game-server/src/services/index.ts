import type { Services } from './types.ts';

let current: Services | null = null;

/** Wired once at boot (index.ts) or per test file. */
export function setServices(s: Services) {
  current = s;
}

export function services(): Services {
  if (!current) throw new Error('services not initialised');
  return current;
}

export type * from './types.ts';
