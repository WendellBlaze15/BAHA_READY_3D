import type { Bag, PlayerStats, SprintState } from '@baha/shared/survival';

export type LifeState = 'alive' | 'downed' | 'dead' | 'disconnected';
export type Weather = 'clear' | 'rain' | 'storm';

/** A hold action (loot container, crafting): moving away or acting cancels it. */
export interface Channel {
  kind: 'loot' | 'craft' | 'revive' | 'build';
  target: string;
  endsAt: number;
  x: number;
  z: number;
}

export interface SimPlayer {
  userId: string;
  username: string;
  role: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  anim: string;
  life: LifeState;
  stats: PlayerStats;
  sprint: SprintState;
  bag: Bag;
  equip: { hand: string | null; body: string | null; feet: string | null };
  /** Last accepted movement sample (t = effective client seconds). */
  last: { x: number; y: number; z: number; t: number | null; at: number };
  /** Ground last stood on (jump envelope reference for ~1.2 s after leaving it). */
  support: { y: number; at: number };
  /** Clock baseline (server − client seconds): bounds how far a client may run "ahead". */
  minOffset: number | null;
  offsetAt: number;
  speed: number;
  movedAt: number;
  violations: number[];
  lastSwingAt: number;
  channel: Channel | null;
  /** Per-action last-use times (sim seconds) for throttles. */
  lastAt: Record<string, number>;

  // Phase 6
  bleedOutAt: number | null;
  /** Respawn/revive protection (sim seconds). */
  protectedUntil: number;
  pendingRespawn: boolean;
  /** Hard permadeath: watches the rest of the run. */
  spectator: boolean;
  deaths: number;
  revivesGiven: number;
  boatStagesBuilt: number;
  sleeping: boolean;
  /** Rats/snakes keep away until (after an axe/shove scare). */
  scaredUntil: number;
  onBoat: boolean;
  rescued: boolean;
}

/** Messages the room must deliver after a sim call (to one player or everyone). */
export type Outbound =
  { to: string | 'all'; type: string; payload: Record<string, unknown> } | never;

export interface LearningEvent {
  userId: string | null;
  day: number;
  eventKey: string;
  isPositive: boolean;
}

export interface ActivityEntry {
  at: number;
  day: number;
  userId: string;
  action: 'deposit' | 'withdraw' | 'craft' | 'build';
  item: string;
  qty: number;
}

/** What changed since the last sync (the room mirrors only these into Colyseus state). */
export interface Dirty {
  loot: Set<string>;
  drops: boolean;
  chops: Set<string>;
  storage: boolean;
  camp: boolean;
  bags: Set<string>;
}
