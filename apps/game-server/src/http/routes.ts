import { timingSafeEqual } from 'node:crypto';
import { createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { SURVIVAL_PROTOCOL_VERSION } from '@baha/shared/survival';
import { z } from 'zod';
import { errInfo, log } from '../log.ts';
import { leaveRunOffline } from '../rooms/persistence.ts';
import { services } from '../services/index.ts';
import { RoomCode } from '../rooms/errors.ts';
import { ROOM_NAME, type RoomMeta } from '../rooms/SurvivalRoom.ts';

const startedAt = Date.now();

function secretMatches(header: string | null, secret: string) {
  const got = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * HTTP surface (besides Colyseus matchmaking):
 * - GET /health — public, no data beyond liveness (Railway health check).
 * - /admin/* — server-to-server only, from the web app's staff API routes, which do the RBAC
 *   (survival.rooms.monitor / force_close) and audit logging. Bearer GAME_SERVER_ADMIN_SECRET.
 * - /internal/runs/* — resume / leave, called by the web app's player API routes after they
 *   verified the session user (same secret; the user id comes from the verified web session).
 */
export function buildRoutes(adminSecret: string) {
  const guard = (headers: Headers) => {
    if (!secretMatches(headers.get('authorization'), adminSecret)) {
      log.warn('admin auth failed');
      return false;
    }
    return true;
  };

  const userBody = z.object({ userId: z.uuid() }).strict();
  const runIdOk = (id: string) => z.uuid().safeParse(id).success;
  /** In-process guard so two simultaneous "resume" clicks create one room. */
  const resuming = new Map<string, Promise<string>>();

  async function liveRoomOf(runId: string) {
    const roomId = await services().liveRuns.get(runId);
    if (!roomId) return null;
    const rooms = await matchMaker.query({ roomId });
    return rooms.length ? roomId : null;
  }

  return createRouter({
    health: createEndpoint('/health', { method: 'GET' }, async (ctx) =>
      ctx.json({
        ok: true,
        protocol: SURVIVAL_PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      }),
    ),

    rooms: createEndpoint('/admin/rooms', { method: 'GET', requireHeaders: true }, async (ctx) => {
      if (!guard(ctx.headers)) throw ctx.error(401, { message: 'unauthorized' });
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      return ctx.json({
        rooms: rooms.map((r) => {
          const m = (r.metadata ?? {}) as Partial<RoomMeta>;
          return {
            roomId: r.roomId,
            clients: r.clients,
            maxClients: r.maxClients,
            locked: r.locked,
            phase: m.phase ?? 'lobby',
            mode: m.mode,
            difficulty: m.difficulty,
            hostUsername: m.hostUsername,
            createdAt: m.createdAt,
          };
        }),
        memory: process.memoryUsage().rss,
      });
    }),

    resumeRun: createEndpoint(
      '/internal/runs/:runId/resume',
      { method: 'POST', requireHeaders: true, body: userBody },
      async (ctx) => {
        if (!guard(ctx.headers)) throw ctx.error(401, { message: 'unauthorized' });
        const { runId } = ctx.params;
        if (!runIdOk(runId)) throw ctx.error(400, { message: 'bad_run_id' });
        const { userId } = ctx.body;
        const s = services();
        if (!(await s.limiter.check('resume', userId)))
          throw ctx.error(429, { message: 'rate_limited' });
        const run = await s.db.loadRun(runId);
        if (!run || !run.members.some((m) => m.userId === userId && m.status === 'active'))
          throw ctx.error(403, { message: 'not_member' });
        if (run.status !== 'active') throw ctx.error(410, { message: 'run_not_active' });
        const live = await liveRoomOf(runId);
        if (live) return ctx.json({ roomId: live, created: false });
        let p = resuming.get(runId);
        if (!p) {
          p = matchMaker
            .createRoom(ROOM_NAME, { __resume: { runId, by: userId } })
            .then((r) => r.roomId)
            .finally(() => resuming.delete(runId));
          resuming.set(runId, p);
        }
        try {
          return ctx.json({ roomId: await p, created: true });
        } catch (e) {
          log.error('resume failed', { runId, ...errInfo(e) });
          throw ctx.error(503, { message: 'resume_failed' });
        }
      },
    ),

    leaveRun: createEndpoint(
      '/internal/runs/:runId/leave',
      { method: 'POST', requireHeaders: true, body: userBody },
      async (ctx) => {
        if (!guard(ctx.headers)) throw ctx.error(401, { message: 'unauthorized' });
        const { runId } = ctx.params;
        if (!runIdOk(runId)) throw ctx.error(400, { message: 'bad_run_id' });
        const { userId } = ctx.body;
        const live = await liveRoomOf(runId);
        const r = live
          ? ((await matchMaker.remoteRoomCall(live, 'leaveRun', [userId])) as { ok: boolean })
          : await leaveRunOffline(runId, userId);
        if (!r.ok) throw ctx.error(403, { message: 'not_member' });
        return ctx.json({ ok: true });
      },
    ),

    closeRoom: createEndpoint(
      '/admin/rooms/:roomId/close',
      { method: 'POST', requireHeaders: true },
      async (ctx) => {
        if (!guard(ctx.headers)) throw ctx.error(401, { message: 'unauthorized' });
        const roomId = ctx.params.roomId;
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw ctx.error(400, { message: 'bad_room_id' });
        try {
          await matchMaker.remoteRoomCall(roomId, 'disconnect', [RoomCode.FORCE_CLOSED]);
        } catch {
          throw ctx.error(404, { message: 'room_not_found' });
        }
        log.info('room force-closed by admin', { roomId });
        return ctx.json({ ok: true });
      },
    ),
  });
}
