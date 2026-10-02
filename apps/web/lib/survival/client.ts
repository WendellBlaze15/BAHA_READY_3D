'use client';

import { ColyseusSDK, type Room } from '@colyseus/sdk';
import { SURVIVAL_PROTOCOL_VERSION, type Difficulty } from '@baha/shared/survival';
import { publicEnv } from '@/lib/env/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';

export const ROOM_NAME = 'survival';

/** Close / matchmake codes from apps/game-server/src/rooms/errors.ts → survival.errors.* keys. */
const CODE_KEYS: Record<number, string> = {
  401: 'unauthorized',
  403: 'not_eligible',
  409: 'too_many_runs',
  410: 'run_not_active',
  422: 'generic',
  423: 'disabled',
  426: 'outdated_client',
  429: 'rate_limited',
  503: 'unavailable',
  4101: 'kicked',
  4102: 'lobby_idle',
  4103: 'eligibility_lost',
  4104: 'force_closed',
  4106: 'already_started',
  4109: 'duplicate_session',
  4110: 'run_abandoned',
  4111: 'rested',
  4112: 'left_run',
  4113: 'not_member',
  4114: 'survival_disabled',
  4115: 'blocked',
  4199: 'server_restarting',
};

export function errorKey(e: unknown): string {
  const code = (e as { code?: number })?.code;
  const msg = (e as { message?: string })?.message ?? '';
  if (msg === 'origin_not_allowed') return 'generic';
  if (typeof code === 'number' && CODE_KEYS[code]) return CODE_KEYS[code]!;
  if (/fetch|network|failed to connect/i.test(msg)) return 'unavailable';
  return 'generic';
}

/** Codes that end the session for good (no auto-reconnect UI). */
export const FINAL_CLOSE_CODES = new Set([
  4101, 4102, 4103, 4104, 4106, 4109, 4110, 4111, 4112, 4113, 4114, 4115,
]);
export const closeKey = (code: number) => CODE_KEYS[code] ?? null;

export function gameServerConfigured() {
  return !!publicEnv.NEXT_PUBLIC_GAME_SERVER_URL;
}

async function sdk() {
  const url = publicEnv.NEXT_PUBLIC_GAME_SERVER_URL;
  if (!url) throw Object.assign(new Error('unavailable'), { code: 503 });
  const httpUrl = url.replace(/^ws/, 'http');
  const client = new ColyseusSDK(httpUrl);
  const { data } = await getSupabaseBrowser().auth.getSession();
  if (!data.session) throw Object.assign(new Error('unauthorized'), { code: 401 });
  client.auth.token = data.session.access_token;
  return client;
}

export async function createRoom(mode: 'solo' | 'coop', difficulty: Difficulty) {
  return (await sdk()).create(ROOM_NAME, { protocol: SURVIVAL_PROTOCOL_VERSION, mode, difficulty });
}

export async function joinRoom(roomId: string) {
  return (await sdk()).joinById(roomId, { protocol: SURVIVAL_PROTOCOL_VERSION });
}

export type SurvivalRoomHandle = Room;

/** Calls our own API (same-origin, JSON envelope). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as
    | { data: T; error: null }
    | { data: null; error: { message: string; retry_after?: number } }
    | null;
  if (!res.ok || !body || body.error)
    throw Object.assign(new Error(body?.error?.message ?? 'errors.internal'), {
      messageKey: body?.error?.message ?? 'errors.internal',
      status: res.status,
    });
  return body.data as T;
}
