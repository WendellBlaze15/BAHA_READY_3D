import { z } from 'zod';

/**
 * Gameplay event log. `t` = seconds since the attempt started (client clock, validated
 * for monotonicity and plausibility on the server). Kept compact: max 256 KB per attempt.
 */
const t = z.number().min(0).max(3600);
const key = z.string().regex(/^[a-z0-9_]{1,40}$/);
const id = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const coord = z.number().min(-1000).max(1000);

export const gameEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      t,
      type: z.literal('phase'),
      payload: z.object({ phase: z.enum(['prep', 'evac', 'end']) }).strict(),
    })
    .strict(),
  z
    .object({ t, type: z.literal('item_packed'), payload: z.object({ item: key }).strict() })
    .strict(),
  z
    .object({ t, type: z.literal('item_unpacked'), payload: z.object({ item: key }).strict() })
    .strict(),
  z.object({ t, type: z.literal('task_done'), payload: z.object({ task: key }).strict() }).strict(),
  z
    .object({ t, type: z.literal('pos'), payload: z.object({ x: coord, z: coord }).strict() })
    .strict(),
  z.object({ t, type: z.literal('hazard_hit'), payload: z.object({ id, key }).strict() }).strict(),
  z.object({ t, type: z.literal('npc_follow'), payload: z.object({ id }).strict() }).strict(),
  z.object({ t, type: z.literal('npc_rescued'), payload: z.object({ id }).strict() }).strict(),
  z
    .object({
      t,
      type: z.literal('announcement'),
      payload: z.object({ index: z.number().int().min(0).max(20) }).strict(),
    })
    .strict(),
  z.object({ t, type: z.literal('health_zero'), payload: z.object({}).strict() }).strict(),
  z.object({ t, type: z.literal('evac_reached'), payload: z.object({}).strict() }).strict(),
  z
    .object({
      t,
      type: z.literal('timeout'),
      payload: z.object({ phase: z.enum(['prep', 'evac']) }).strict(),
    })
    .strict(),
  z.object({ t, type: z.literal('quit'), payload: z.object({}).strict() }).strict(),
]);

export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameEventType = GameEvent['type'];

export const MAX_EVENTS = 4000;
export const MAX_EVENT_BYTES = 256 * 1024;

export const eventLogSchema = z.array(gameEventSchema).max(MAX_EVENTS);

/** Client-side summary sent alongside events; only compared, never trusted. */
export const clientSummarySchema = z
  .object({
    score: z.number().int(),
    stars: z.number().int().min(0).max(3),
    outcome: z.enum(['completed', 'failed']),
    durationMs: z.number().int().min(0),
  })
  .strict();

export type ClientSummary = z.infer<typeof clientSummarySchema>;
