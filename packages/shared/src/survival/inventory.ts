import type { ItemDef, SurvivalConfig } from './config.ts';

/**
 * Personal bag (Section 8.1): slots + weight, stackable items, tool durability.
 * Pure functions returning new bags — the game server owns the authoritative copy.
 */
export type Slot = { item: string; qty: number; durability?: number } | null;
export type Bag = Slot[];

export const emptyBag = (cfg: SurvivalConfig['bag']): Bag =>
  Array.from({ length: cfg.slots }, () => null);

export type ItemIndex = Map<string, ItemDef>;
export const indexItems = (items: ItemDef[]): ItemIndex => new Map(items.map((i) => [i.key, i]));

export function bagWeight(bag: Bag, items: ItemIndex) {
  let w = 0;
  for (const s of bag) if (s) w += (items.get(s.item)?.weightKg ?? 0) * s.qty;
  return Math.round(w * 100) / 100;
}

export const countItem = (bag: Bag, item: string) =>
  bag.reduce((n, s) => n + (s && s.item === item ? s.qty : 0), 0);

/**
 * Adds up to `qty` of `item`, filling existing stacks first, then empty slots. Weight may go
 * over the limit (the player just moves slower / can't swim) — that's the lesson.
 */
export function addItem(
  bag: Bag,
  item: string,
  qty: number,
  items: ItemIndex,
): { bag: Bag; added: number; leftover: number } {
  const def = items.get(item);
  if (!def || qty <= 0) return { bag, added: 0, leftover: qty };
  const next = bag.map((s) => (s ? { ...s } : null));
  let left = qty;
  for (const s of next) {
    if (left === 0) break;
    if (s && s.item === item && s.qty < def.stack) {
      const put = Math.min(def.stack - s.qty, left);
      s.qty += put;
      left -= put;
    }
  }
  for (let i = 0; i < next.length && left > 0; i++) {
    if (next[i]) continue;
    const put = Math.min(def.stack, left);
    next[i] = { item, qty: put, ...(def.durability ? { durability: def.durability } : {}) };
    left -= put;
  }
  return { bag: next, added: qty - left, leftover: left };
}

/** Removes `qty` of `item` (from the last stacks first). Returns null if not enough. */
export function removeItem(bag: Bag, item: string, qty: number): Bag | null {
  if (countItem(bag, item) < qty) return null;
  const next = bag.map((s) => (s ? { ...s } : null));
  let left = qty;
  for (let i = next.length - 1; i >= 0 && left > 0; i--) {
    const s = next[i];
    if (!s || s.item !== item) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) next[i] = null;
  }
  return next;
}

/** Wears a tool by one use; it breaks (slot cleared) at 0. Returns null if the tool is missing. */
export function wearTool(bag: Bag, item: string): { bag: Bag; broke: boolean } | null {
  const i = bag.findIndex((s) => s?.item === item);
  if (i < 0) return null;
  const next = bag.map((s) => (s ? { ...s } : null));
  const s = next[i]!;
  if (s.durability === undefined) return { bag: next, broke: false };
  s.durability -= 1;
  if (s.durability <= 0) {
    s.qty -= 1;
    if (s.qty <= 0) next[i] = null;
    return { bag: next, broke: true };
  }
  return { bag: next, broke: false };
}

export function moveSlot(bag: Bag, from: number, to: number): Bag | null {
  if (from === to || !bag[from] || to < 0 || to >= bag.length) return null;
  const next = bag.map((s) => (s ? { ...s } : null));
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function splitSlot(bag: Bag, from: number, qty: number): Bag | null {
  const s = bag[from];
  const empty = bag.findIndex((x) => x === null);
  if (!s || s.durability !== undefined || qty <= 0 || qty >= s.qty || empty < 0) return null;
  const next = bag.map((x) => (x ? { ...x } : null));
  next[from] = { ...s, qty: s.qty - qty };
  next[empty] = { item: s.item, qty };
  return next;
}
