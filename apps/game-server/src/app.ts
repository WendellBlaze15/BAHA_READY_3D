import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { allowedOrigins } from './policy.ts';
import { buildRoutes } from './http/routes.ts';
import { ROOM_NAME, SurvivalRoom } from './rooms/SurvivalRoom.ts';

/**
 * Server definition shared by index.ts (listen) and the tests (@colyseus/testing boot).
 * Services and policy must be set before this is called.
 */
export function buildServer(adminSecret: string) {
  // Only create / joinById / reconnect: no public room listing, no "join any room".
  matchMaker.controller.exposedMethods = ['create', 'joinById', 'reconnect'];
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    const ok = origin && allowedOrigins().includes(origin.replace(/\/+$/, ''));
    return {
      ...matchMaker.controller.DEFAULT_CORS_HEADERS,
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      Vary: 'Origin',
    };
  };

  return defineServer({
    rooms: { [ROOM_NAME]: defineRoom(SurvivalRoom) },
    routes: buildRoutes(adminSecret),
    transport: new WebSocketTransport({
      pingInterval: 5000,
      pingMaxRetries: 3,
      maxPayload: 16 * 1024,
    }),
    greet: false,
  });
}
