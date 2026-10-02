import 'server-only';
import { fail } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env/server';
import { getRedis } from '@/lib/ratelimit';

/**
 * Survival Mode API guard: signed-in, active, onboarded AND eligible right now (live
 * can_play_survival — not the up-to-1h-old JWT claim) with the kill switch on.
 */
export async function requireSurvivalPlayer() {
  const ctx = await requireUser({ onboarded: true });
  const [{ data: can }, { data: enabled }] = await Promise.all([
    ctx.supabase.rpc('can_play_survival', { uid: ctx.userId }),
    ctx.supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'survival_enabled')
      .maybeSingle(),
  ]);
  if (enabled && (enabled.value === false || enabled.value === 'false'))
    throw fail('FORBIDDEN', 'survival.errors.disabled');
  if (can !== true) throw fail('FORBIDDEN', 'survival.errors.not_eligible');
  return ctx;
}

/** Server-to-server call to the game server's /internal + /admin API (never from the browser). */
export async function gameServer<T>(
  path: string,
  body?: unknown,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const env = serverEnv();
  if (!env.GAME_SERVER_HTTP_URL || !env.GAME_SERVER_ADMIN_SECRET)
    throw fail('MAINTENANCE', 'survival.errors.unavailable');
  let res: Response;
  try {
    res = await fetch(`${env.GAME_SERVER_HTTP_URL.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.GAME_SERVER_ADMIN_SECRET}`,
        'content-type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      // The server sleeps when idle; the first request wakes it.
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw fail('MAINTENANCE', 'survival.errors.unavailable');
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (res.ok) return data;
  if (res.status === 404) throw fail('NOT_FOUND', 'errors.not_found');
  if (res.status === 403) throw fail('FORBIDDEN', 'survival.errors.not_member');
  if (res.status === 410) throw fail('CONFLICT', 'survival.errors.run_not_active');
  if (res.status === 429) throw fail('RATE_LIMITED', 'errors.rate_limited', { retry_after: 60 });
  throw fail('MAINTENANCE', 'survival.errors.unavailable');
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SURVIVAL_CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

/** Wrong codes: 10 within 15 min → 15-minute cooldown (anti brute force, Section 20.3). */
export async function resolveJoinCode(userId: string, code: string) {
  const redis = getRedis();
  const wrongKey = `survival:wrongcode:${userId}`;
  const wrong = Number((await redis.get<number>(wrongKey)) ?? 0);
  if (wrong >= 10)
    throw fail('RATE_LIMITED', 'survival.errors.too_many_wrong_codes', { retry_after: 900 });
  const roomId = await redis.get<string>(`survival:code:${code}`);
  if (!roomId) {
    const n = await redis.incr(wrongKey);
    if (n === 1) await redis.expire(wrongKey, 900);
    throw fail('NOT_FOUND', 'survival.errors.code_not_found');
  }
  return roomId;
}
