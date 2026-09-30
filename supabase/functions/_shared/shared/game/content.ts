// AUTO-SYNCED from packages/shared/src by scripts/sync-functions-shared.mjs. Do not edit.
/** Game content needed by layout + scoring (subset of the content tables). */
export type ItemDef = {
  key: string;
  weight_kg: number;
  category: string;
  is_essential: boolean;
  points: number;
};
export type TaskDef = { key: string; points: number };
export type HazardDef = { key: string; penalty: number; instant_fail: boolean };
export type NpcDef = { key: string; points: number; needs: Record<string, unknown> };

export type GameContent = {
  items: ItemDef[];
  tasks: TaskDef[];
  hazards: HazardDef[];
  npcs: NpcDef[];
};

/**
 * Health damage per hazard hit (out of 100). Shared so the server can independently decide
 * that too many hits would have been fatal, even if a client omits `health_zero`.
 */
export const HAZARD_DAMAGE: Record<string, number> = {
  live_wire: 100,
  open_manhole: 35,
  debris: 15,
  collapsing_structure: 40,
  strong_current: 25,
  lightning_exposure: 45,
};
export const DEFAULT_HAZARD_DAMAGE = 20;

export function indexBy<T extends { key: string }>(arr: T[]) {
  return new Map(arr.map((x) => [x.key, x]));
}
