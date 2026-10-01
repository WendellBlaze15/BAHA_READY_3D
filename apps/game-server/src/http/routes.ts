import { timingSafeEqual } from 'node:crypto';
import { createEndpoint, createRouter, matchMaker } from '@colyseus/core';
import { SURVIVAL_PROTOCOL_VERSION } from '@baha/shared/survival';
import { log } from '../log.ts';
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
 */
export function buildRoutes(adminSecret: string) {
  const guard = (headers: Headers) => {
    if (!secretMatches(headers.get('authorization'), adminSecret)) {
      log.warn('admin auth failed');
      return false;
    }
    return true;
  };

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
