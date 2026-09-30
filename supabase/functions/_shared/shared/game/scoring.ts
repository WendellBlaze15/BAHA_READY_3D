// AUTO-SYNCED from packages/shared/src by scripts/sync-functions-shared.mjs. Do not edit.
import type { LevelConfig } from '../level-config.ts';
import { DEFAULT_HAZARD_DAMAGE, HAZARD_DAMAGE, indexBy, type GameContent } from './content.ts';
import type { GameEvent } from './events.ts';
import { dist, type Layout, type Vec2 } from './layout.ts';
import {
  initialSprintState,
  setSprintIntent,
  stepSprint,
  tryJump,
  withActions,
} from './stamina.ts';

export type FlagReason =
  | 'EVENT_ORDER_INVALID'
  | 'DURATION_TOO_SHORT'
  | 'DURATION_TOO_LONG'
  | 'SPEED_IMPOSSIBLE'
  | 'ITEM_UNKNOWN'
  | 'OVERWEIGHT'
  | 'TASK_UNKNOWN'
  | 'NPC_RESCUE_INVALID'
  | 'HAZARD_INVALID'
  | 'EVAC_INVALID'
  | 'TOO_MANY_EVENTS'
  | 'SUMMARY_MISMATCH';

export type FeedbackItem = {
  kind: 'good' | 'improve' | 'danger';
  ref: 'item' | 'task' | 'hazard' | 'npc' | 'general';
  key: string;
  /** Points contributed (+/-), for the breakdown. */
  points?: number;
};

export type ScoreBreakdown = {
  essentials: number;
  nonEssentialItems: number;
  tasks: number;
  npcs: number;
  timeBonus: number;
  nonEssentialWeightPenalty: number;
  hazardPenalty: number;
  wrongActionPenalty: number;
};

export type AttemptResult = {
  outcome: 'completed' | 'failed';
  failReason: 'health' | 'timeout' | 'instant_fail' | 'quit' | null;
  score: number;
  stars: 0 | 1 | 2 | 3;
  breakdown: ScoreBreakdown;
  packed: string[];
  tasksDone: string[];
  npcsRescued: number;
  npcsTotal: number;
  hazardHits: number;
  wrongActions: number;
  timeRemainingSec: number;
  durationMs: number;
  prepScore: number;
  maxPrepScore: number;
  totalWeightKg: number;
  feedback: FeedbackItem[];
  /** Keys used to unlock personalized tips (tips.unlock_rule {type:'mistake', key}). */
  mistakes: string[];
  flags: FlagReason[];
};

const TOLERANCE_SEC = 10;
const SPEED_TOLERANCE = 1.2;
const POS_JUMP_TOLERANCE_M = 1.5;
/** Sustained-speed window: jitter is forgiven once per window, not once per sample. */
const SPEED_WINDOW_SEC = 4;
const PROXIMITY_M = 5;

/**
 * Authoritative result from an event log. Pure and deterministic: the Edge Function uses it
 * to compute the official score; the client uses it only as a preview.
 */
export function computeResult(
  config: LevelConfig,
  content: GameContent,
  layout: Layout,
  events: GameEvent[],
): AttemptResult {
  const flags = new Set<FlagReason>();
  const items = indexBy(content.items);
  const tasks = indexBy(content.tasks);
  const hazardsDef = indexBy(content.hazards);
  const npcDefs = indexBy(content.npcs);
  const levelItems = new Set(config.items);
  const levelTasks = new Set(config.homeTasks);
  const hazardById = new Map(layout.hazards.map((h) => [h.id, h]));
  const npcById = new Map(layout.npcs.map((n) => [n.id, n]));

  if (events.length > 4000) flags.add('TOO_MANY_EVENTS');

  // ── Ordering and phase timing ──────────────────────────────────────
  let lastT = -1;
  let prepStart: number | null = null;
  let evacStart: number | null = null;
  let endT: number | null = null;
  for (const e of events) {
    if (e.t + 1e-6 < lastT) flags.add('EVENT_ORDER_INVALID');
    lastT = Math.max(lastT, e.t);
    if (e.type === 'phase') {
      if (e.payload.phase === 'prep') {
        if (prepStart !== null || evacStart !== null) flags.add('EVENT_ORDER_INVALID');
        prepStart = e.t;
      } else if (e.payload.phase === 'evac') {
        if (evacStart !== null) flags.add('EVENT_ORDER_INVALID');
        evacStart = e.t;
      } else endT = e.t;
    }
  }
  if (prepStart === null) prepStart = 0;
  if (evacStart === null) flags.add('EVENT_ORDER_INVALID');
  const lastEventT = events.length ? events[events.length - 1]!.t : 0;
  endT ??= lastEventT;
  const durationMs = Math.round(endT * 1000);

  if (endT < config.minDurationSec) flags.add('DURATION_TOO_SHORT');
  if (
    config.prepTimeSec !== null &&
    evacStart !== null &&
    evacStart - prepStart > config.prepTimeSec + TOLERANCE_SEC
  ) {
    flags.add('DURATION_TOO_LONG');
  }
  if (evacStart !== null && endT - evacStart > config.evacTimeSec + TOLERANCE_SEC)
    flags.add('DURATION_TOO_LONG');

  // ── Prep: go-bag and home tasks (only events before evac) ─────────
  const packed = new Set<string>();
  const tasksDone = new Set<string>();
  for (const e of events) {
    const beforeEvac = evacStart === null || e.t <= evacStart + 1e-6;
    if (e.type === 'item_packed') {
      if (!beforeEvac) flags.add('EVENT_ORDER_INVALID');
      if (!items.has(e.payload.item) || !levelItems.has(e.payload.item)) flags.add('ITEM_UNKNOWN');
      else packed.add(e.payload.item);
    } else if (e.type === 'item_unpacked') {
      packed.delete(e.payload.item);
    } else if (e.type === 'task_done') {
      if (!beforeEvac) flags.add('EVENT_ORDER_INVALID');
      if (!tasks.has(e.payload.task) || !levelTasks.has(e.payload.task)) flags.add('TASK_UNKNOWN');
      else tasksDone.add(e.payload.task);
    }
  }
  let totalWeight = 0;
  let nonEssentialWeight = 0;
  let essentialPts = 0;
  let nonEssentialPts = 0;
  for (const k of packed) {
    const it = items.get(k)!;
    totalWeight += it.weight_kg;
    if (it.is_essential) essentialPts += it.points;
    else {
      nonEssentialPts += it.points;
      if (it.category === 'non_essential') nonEssentialWeight += it.weight_kg;
    }
  }
  totalWeight = Math.round(totalWeight * 100) / 100;
  if (totalWeight > config.weightLimitKg + 1e-6) flags.add('OVERWEIGHT');
  const taskPts = [...tasksDone].reduce((s, k) => s + (tasks.get(k)?.points ?? 0), 0);

  const levelEssentials = config.items.filter((k) => items.get(k)?.is_essential);
  const maxPrepScore =
    levelEssentials.reduce((s, k) => s + (items.get(k)?.points ?? 0), 0) +
    config.homeTasks.reduce((s, k) => s + (tasks.get(k)?.points ?? 0), 0);
  const prepScore = essentialPts + taskPts;

  // ── Evacuation: positions (with stamina-replayed sprint), hazards, NPCs ──
  // Sprint speed is granted only for seconds the replayed stamina could pay for. The replay
  // ignores terrain drains, so it can only over-estimate real stamina: honest runs never flag.
  const actions = withActions(config.actions);
  const positions: { t: number; p: Vec2 }[] = [];
  let prevPos: { t: number; p: Vec2 } | null = null;
  let sprint = initialSprintState();
  let sprintClock = 0;
  let segmentSprintSec = 0;
  let segmentLockedSec = 0;
  // Whole-lockout window: while the replay says sprint is locked ("Hingal"), the distance
  // covered must fit walking speed. The replay's lockout always lies inside the client's real
  // one (replay stamina is an upper bound), so honest runs can't trip this.
  let lockDist = 0;
  let lockTime = 0;
  const windowSegs: { dt: number; d: number; allowed: number }[] = [];
  let winDt = 0;
  let winD = 0;
  let winAllowed = 0;
  const closeLockWindow = () => {
    if (
      lockTime > 0 &&
      lockDist > config.maxSpeed * SPEED_TOLERANCE * lockTime + POS_JUMP_TOLERANCE_M
    )
      flags.add('SPEED_IMPOSSIBLE');
    lockDist = 0;
    lockTime = 0;
  };
  const advanceTo = (t: number) => {
    if (t <= sprintClock) return;
    const r = stepSprint(sprint, t - sprintClock, actions);
    sprint = r.state;
    segmentSprintSec += r.sprintSeconds;
    segmentLockedSec += r.lockedSeconds;
    sprintClock = t;
  };
  for (const e of events) {
    if (e.type === 'sprint') {
      advanceTo(e.t);
      sprint = setSprintIntent(sprint, e.payload.on);
      continue;
    }
    if (e.type === 'jump') {
      advanceTo(e.t);
      sprint = tryJump(sprint, actions) ?? sprint; // a disallowed jump is just ignored
      continue;
    }
    if (e.type !== 'pos') continue;
    advanceTo(e.t);
    const cur = { t: e.t, p: { x: e.payload.x, z: e.payload.z } };
    if (prevPos) {
      const dt = cur.t - prevPos.t;
      const d = dist(cur.p, prevPos.p);
      const bonus = (actions.sprintMultiplier - 1) * Math.min(segmentSprintSec, Math.max(0, dt));
      const allowed = config.maxSpeed * SPEED_TOLERANCE * (Math.max(0, dt) + bonus);
      if (dt <= 0 && d > POS_JUMP_TOLERANCE_M) flags.add('SPEED_IMPOSSIBLE');
      else if (dt > 0 && d > allowed + POS_JUMP_TOLERANCE_M) flags.add('SPEED_IMPOSSIBLE');
      if (dt > 0) {
        windowSegs.push({ dt, d, allowed });
        winDt += dt;
        winD += d;
        winAllowed += allowed;
        while (windowSegs.length > 1 && winDt - windowSegs[0]!.dt >= SPEED_WINDOW_SEC) {
          const old = windowSegs.shift()!;
          winDt -= old.dt;
          winD -= old.d;
          winAllowed -= old.allowed;
        }
        if (winDt >= SPEED_WINDOW_SEC - 1e-6 && winD > winAllowed + POS_JUMP_TOLERANCE_M)
          flags.add('SPEED_IMPOSSIBLE');
      }
      if (dt > 0) {
        const locked = Math.min(segmentLockedSec, dt);
        if (locked > 0) {
          lockDist += d * (locked / dt);
          lockTime += locked;
        }
        if (!sprint.exhausted) closeLockWindow(); // window ends when the lockout does
      }
    } else if (dist(cur.p, layout.start) > 8) {
      flags.add('SPEED_IMPOSSIBLE');
    }
    segmentSprintSec = 0;
    segmentLockedSec = 0;
    positions.push(cur);
    prevPos = cur;
  }
  closeLockWindow();
  const near = (target: Vec2, t: number, radius: number, window = 1.5) =>
    positions.some((s) => Math.abs(s.t - t) <= window && dist(s.p, target) <= radius);

  let hazardHits = 0;
  let hazardPenalty = 0;
  let damage = 0;
  let instantFail = false;
  const hazardKeysHit = new Set<string>();
  const seenHazards = new Set<string>();
  for (const e of events) {
    if (e.type !== 'hazard_hit') continue;
    const h = hazardById.get(e.payload.id);
    if (!h || h.key !== e.payload.key || !near(h.pos, e.t, h.radius + PROXIMITY_M)) {
      flags.add('HAZARD_INVALID');
      continue;
    }
    if (seenHazards.has(h.id)) continue; // each hazard counts once
    seenHazards.add(h.id);
    hazardHits++;
    hazardKeysHit.add(h.key);
    const def = hazardsDef.get(h.key);
    hazardPenalty += def?.penalty ?? 0;
    damage += HAZARD_DAMAGE[h.key] ?? DEFAULT_HAZARD_DAMAGE;
    if (def?.instant_fail) instantFail = true;
  }

  const following = new Map<string, number>();
  const rescued = new Set<string>();
  for (const e of events) {
    if (e.type === 'npc_follow') {
      const n = npcById.get(e.payload.id);
      if (!n || !near(n.pos, e.t, PROXIMITY_M + 2, 2)) flags.add('NPC_RESCUE_INVALID');
      else following.set(n.id, e.t);
    } else if (e.type === 'npc_rescued') {
      const n = npcById.get(e.payload.id);
      if (!n || !following.has(n.id)) flags.add('NPC_RESCUE_INVALID');
      else if (!near(layout.evac.center, e.t, layout.evac.radius + PROXIMITY_M, 2))
        flags.add('NPC_RESCUE_INVALID');
      else {
        // A pet needs its carrier to be rescued.
        const needs = npcDefs.get(n.key)?.needs as { requiresItem?: string } | undefined;
        if (needs?.requiresItem && !packed.has(needs.requiresItem)) flags.add('NPC_RESCUE_INVALID');
        else rescued.add(n.id);
      }
    }
  }
  const abandoned = [...following.keys()].filter((id) => !rescued.has(id));

  // ── Outcome ───────────────────────────────────────────────────────
  const reached = events.find((e) => e.type === 'evac_reached');
  let failReason: AttemptResult['failReason'] = null;
  if (reached) {
    const last = positions.filter((s) => s.t <= reached.t + 1).at(-1);
    if (!last || dist(last.p, layout.evac.center) > layout.evac.radius + 3)
      flags.add('EVAC_INVALID');
  }
  if (instantFail) failReason = 'instant_fail';
  else if (damage >= 100 || events.some((e) => e.type === 'health_zero')) failReason = 'health';
  else if (events.some((e) => e.type === 'quit')) failReason = 'quit';
  else if (!reached) failReason = 'timeout';
  else if (evacStart !== null && reached.t - evacStart > config.evacTimeSec + TOLERANCE_SEC)
    failReason = 'timeout';
  const survived = failReason === null;

  const timeRemaining =
    survived && evacStart !== null && reached
      ? Math.max(0, Math.floor(config.evacTimeSec - (reached.t - evacStart)))
      : 0;

  const npcPts = [...rescued].reduce(
    (s, id) => s + (npcDefs.get(npcById.get(id)!.key)?.points ?? 0),
    0,
  );
  const sc = config.scoring;
  const breakdown: ScoreBreakdown = {
    essentials: essentialPts,
    nonEssentialItems: nonEssentialPts,
    tasks: taskPts,
    npcs: npcPts,
    timeBonus: timeRemaining * sc.timeBonusPerSec,
    nonEssentialWeightPenalty: -Math.round(nonEssentialWeight * sc.nonEssentialPenaltyPerKg),
    hazardPenalty: -hazardPenalty,
    wrongActionPenalty: -abandoned.length * sc.wrongActionPenalty,
  };
  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = survived ? Math.max(0, Math.round(raw)) : Math.max(0, Math.round(raw / 2));

  const allEssentials = levelEssentials.every((k) => packed.has(k));
  const allTasks = config.homeTasks.every((k) => tasksDone.has(k));
  const requiredOk = config.requiredItems.every((k) => packed.has(k));
  const allNpcs = rescued.size === layout.npcs.length;
  let stars: 0 | 1 | 2 | 3 = 0;
  if (survived && requiredOk) {
    stars = 1;
    if (maxPrepScore > 0 && prepScore >= config.stars.twoStarPrepRatio * maxPrepScore) stars = 2;
    if (allEssentials && allTasks && allNpcs && hazardHits === 0) stars = 3;
  }

  // ── Learning feedback ─────────────────────────────────────────────
  const feedback: FeedbackItem[] = [];
  const mistakes = new Set<string>();
  for (const k of levelEssentials) {
    const pts = items.get(k)?.points ?? 0;
    if (packed.has(k)) feedback.push({ kind: 'good', ref: 'item', key: k, points: pts });
    else {
      feedback.push({ kind: 'improve', ref: 'item', key: k });
      mistakes.add(`missing_${k}`);
    }
  }
  for (const k of packed) {
    const it = items.get(k)!;
    if (!it.is_essential && it.category === 'non_essential') {
      feedback.push({ kind: 'improve', ref: 'item', key: k, points: it.points });
      mistakes.add(`packed_${k}`);
    } else if (!it.is_essential)
      feedback.push({ kind: 'good', ref: 'item', key: k, points: it.points });
  }
  if (nonEssentialWeight >= 2) mistakes.add('overweight_gobag');
  for (const k of config.homeTasks) {
    if (tasksDone.has(k))
      feedback.push({ kind: 'good', ref: 'task', key: k, points: tasks.get(k)?.points });
    else {
      feedback.push({ kind: 'improve', ref: 'task', key: k });
      mistakes.add(`skipped_${k}`);
    }
  }
  for (const k of config.requiredItems) {
    if (!packed.has(k)) feedback.push({ kind: 'danger', ref: 'item', key: k });
  }
  for (const key of hazardKeysHit) {
    feedback.push({
      kind: 'danger',
      ref: 'hazard',
      key,
      points: -(hazardsDef.get(key)?.penalty ?? 0),
    });
    mistakes.add(key);
  }
  for (const n of layout.npcs) {
    if (rescued.has(n.id))
      feedback.push({ kind: 'good', ref: 'npc', key: n.key, points: npcDefs.get(n.key)?.points });
    else {
      feedback.push({ kind: 'improve', ref: 'npc', key: n.key });
      mistakes.add(`npc_left_${n.key}`);
    }
  }
  if (failReason === 'timeout') feedback.push({ kind: 'danger', ref: 'general', key: 'timeout' });
  if (failReason === 'health') feedback.push({ kind: 'danger', ref: 'general', key: 'health' });

  return {
    outcome: survived ? 'completed' : 'failed',
    failReason,
    score,
    stars,
    breakdown,
    packed: [...packed].sort(),
    tasksDone: [...tasksDone].sort(),
    npcsRescued: rescued.size,
    npcsTotal: layout.npcs.length,
    hazardHits,
    wrongActions: abandoned.length,
    timeRemainingSec: timeRemaining,
    durationMs,
    prepScore,
    maxPrepScore,
    totalWeightKg: totalWeight,
    feedback,
    mistakes: [...mistakes].sort(),
    flags: [...flags].sort(),
  };
}
