// AUTO-SYNCED from packages/shared/src by scripts/sync-functions-shared.mjs. Do not edit.
/**
 * Deterministic PRNG (mulberry32). Integer-only operations, so the client preview and the
 * authoritative server (Deno) generate bit-identical layouts from the same seed.
 */
export function createRng(seed: number | bigint | string) {
  let a = toUint32(seed);
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
  };
}

export type Rng = ReturnType<typeof createRng>;

function toUint32(seed: number | bigint | string): number {
  if (typeof seed === 'bigint') return Number(seed & 0xffffffffn) >>> 0;
  if (typeof seed === 'number') return (Math.floor(Math.abs(seed)) % 4294967296) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}
