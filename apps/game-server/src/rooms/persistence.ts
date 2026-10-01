import { lessonFor } from '@baha/shared/survival';
import { errInfo, log } from '../log.ts';
import { services } from '../services/index.ts';
import type { Simulation } from '../sim/simulation.ts';
import { toSnapshot, type Snapshot } from '../sim/snapshot.ts';

/** Payload for public.finish_survival_run (see the Phase 7 migration). */
export function finishPayload(sim: Simulation) {
  const r = sim.obj.result!;
  const total = sim.cfg.session.totalDays;
  const players: Record<string, unknown> = {};
  for (const p of sim.players.values()) {
    const mine = sim.learningLog.filter((l) => l.userId === p.userId);
    const tipKeys = [...new Set(mine.map((l) => lessonFor(l.eventKey)?.tip).filter(Boolean))];
    const survived = p.rescued || (p.life !== 'dead' && !p.spectator);
    players[p.userId] = {
      rescued: p.rescued,
      survived,
      deaths: p.deaths,
      revives_given: p.revivesGiven,
      boat_stages_built: p.boatStagesBuilt,
      // Nights lived through this run (dead-for-good players stop counting).
      nights_survived: Math.max(0, r.summary.daysSurvived - 1 - (p.spectator ? 1 : 0)),
      drank_unsafe: mine.some((l) => l.eventKey === 'drank_unsafe_water'),
      tip_keys: tipKeys,
    };
  }
  const npcs = [...sim.obj.npcs.values()];
  return {
    ending: r.ending,
    days_survived: r.summary.daysSurvived,
    final_score: r.score,
    base_score: r.baseScore,
    team_size: sim.players.size,
    real_minutes: Math.round(sim.playedSec / 60),
    boat_stage: sim.obj.boat.stage,
    learning_summary: r.learning,
    all_npcs_rescued: npcs.length > 0 && npcs.every((n) => n.state === 'rescued'),
    team_deaths: r.summary.deaths,
    total_days: total,
    players,
  };
}

/** Saves a snapshot + run progress; never throws (a failed save is logged and retried next time). */
export async function saveRun(runId: string | null, sim: Simulation, reason: string) {
  if (!runId) return false;
  const db = services().db;
  try {
    const bytes = await db.saveSnapshot(runId, sim.clock.day, sim.clock.minute, toSnapshot(sim));
    await db.updateRunProgress(runId, {
      currentDay: sim.clock.day,
      boatStage: sim.obj.boat.stage,
      flags: [...sim.flags],
    });
    log.info('run saved', { runId, reason, day: sim.clock.day, bytes });
    return true;
  } catch (e) {
    log.error('run save failed', { runId, reason, ...errInfo(e) });
    return false;
  }
}

/**
 * "Umalis sa Team" while no session is live (Section 16.7): the player's bag goes into camp
 * storage in the latest snapshot, membership ends, host passes on, last one out abandons.
 */
export async function leaveRunOffline(runId: string, userId: string) {
  const db = services().db;
  const run = await db.loadRun(runId);
  if (!run) return { ok: false, reason: 'not_found' as const };
  const me = run.members.find((m) => m.userId === userId && m.status === 'active');
  if (!me) return { ok: false, reason: 'not_member' as const };

  const snap = (await db.latestSnapshot(runId)) as Snapshot | null;
  if (snap?.players[userId]) {
    for (const s of snap.players[userId]!.bag)
      if (s) snap.storage[s.item] = (snap.storage[s.item] ?? 0) + s.qty;
    delete snap.players[userId];
    await db.saveSnapshot(runId, snap.clock.day, snap.clock.minute, snap);
  }
  await finishLeave(runId, userId, run.hostId, run.members);
  return { ok: true as const };
}

export async function finishLeave(
  runId: string,
  userId: string,
  hostId: string,
  members: { userId: string; status: string }[],
) {
  const db = services().db;
  await db.setMemberStatus(runId, userId, 'left');
  const remaining = members.filter((m) => m.status === 'active' && m.userId !== userId);
  if (!remaining.length) await db.setRunStatus(runId, 'abandoned');
  else if (hostId === userId) await db.setHost(runId, remaining[0]!.userId);
}
