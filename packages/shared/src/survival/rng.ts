/**
 * Resumable deterministic RNG (mulberry32, same core as game/rng.ts). Its 32-bit state is saved
 * in every snapshot so a resumed run continues the exact same random sequence.
 */
export function createStateRng(state: number) {
  let a = state >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + (max - min) * next(),
    int: (min: number, maxInclusive: number) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
    chance: (p: number) => next() < p,
    getState: () => a,
  };
}

export type StateRng = ReturnType<typeof createStateRng>;

/** Derives a stable 32-bit sub-seed (per system/day) from the run seed. */
export function subSeed(seed: number | bigint, salt: string): number {
  let h = (typeof seed === 'bigint' ? Number(seed & 0xffffffffn) : seed >>> 0) ^ 2166136261;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 16777619);
  return h >>> 0;
}
