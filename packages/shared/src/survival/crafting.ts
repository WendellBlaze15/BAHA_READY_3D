import type { RecipeDef } from './config.ts';
import { addItem, countItem, removeItem, wearTool, type Bag, type ItemIndex } from './inventory.ts';

/** Where the player stands / what the camp has — checked by the server, never trusted from the client. */
export type CraftContext = {
  atCamp: boolean;
  atSignalSpot: boolean;
  fireLit: boolean;
  workbenchTier: number;
  /** Builder perk: share of materials saved (rounded down per input; never below 1). */
  materialSaveRatio?: number;
};

export type CraftCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_here' | 'needs_fire' | 'missing_inputs' | 'missing_tools' | 'needs_workbench';
    };

export function canCraft(r: RecipeDef, bag: Bag, ctx: CraftContext): CraftCheck {
  if (r.where === 'camp' && !ctx.atCamp) return { ok: false, reason: 'not_here' };
  if (r.where === 'workbench2' && (!ctx.atCamp || ctx.workbenchTier < 2))
    return { ok: false, reason: 'needs_workbench' };
  if (r.where === 'signal_spot' && !ctx.atSignalSpot) return { ok: false, reason: 'not_here' };
  if (r.needsFire && !ctx.fireLit) return { ok: false, reason: 'needs_fire' };
  if (r.tools.some((t) => countItem(bag, t) < 1)) return { ok: false, reason: 'missing_tools' };
  if (r.inputs.some((i) => countItem(bag, i.item) < inputQty(i.qty, ctx)))
    return { ok: false, reason: 'missing_inputs' };
  return { ok: true };
}

const inputQty = (qty: number, ctx: CraftContext) =>
  Math.max(1, qty - Math.floor(qty * (ctx.materialSaveRatio ?? 0)));

/**
 * Applies a recipe: consumes inputs, wears tools, adds the output (or reports the structure to
 * build). Call only after canCraft() succeeded.
 */
export function applyCraft(
  r: RecipeDef,
  bag: Bag,
  items: ItemIndex,
  ctx: CraftContext,
): { bag: Bag; structure: string | null; overflow: number; brokeTools: string[] } {
  let next: Bag = bag;
  for (const i of r.inputs) next = removeItem(next, i.item, inputQty(i.qty, ctx))!;
  const brokeTools: string[] = [];
  for (const t of r.tools) {
    const w = wearTool(next, t);
    if (w) {
      next = w.bag;
      if (w.broke) brokeTools.push(t);
    }
  }
  let overflow = 0;
  if (r.output) {
    const added = addItem(next, r.output.item, r.output.qty, items);
    next = added.bag;
    overflow = added.leftover; // the server drops overflow on the ground at the player's feet
  }
  return { bag: next, structure: r.structure ?? null, overflow, brokeTools };
}
