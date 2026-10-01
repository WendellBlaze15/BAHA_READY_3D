import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { survivalConfigSchema } from '@baha/shared/survival';
import type { Env } from '../env.ts';
import { errInfo, log } from '../log.ts';
import { randomCode } from './codes.ts';
import type {
  CodeStore,
  Eligibility,
  Identity,
  LimitAction,
  RateLimiter,
  Services,
} from './types.ts';

const LIMITS: Record<LimitAction, { limit: number; window: Duration }> = {
  room_create: { limit: 6, window: '10 m' },
  room_join: { limit: 30, window: '10 m' },
  code_lookup: { limit: 20, window: '5 m' },
  chat_send: { limit: 12, window: '30 s' },
};

const CODE_PREFIX = 'survival:code:';

/** Production services: Supabase (service role, server-side only) + Upstash Redis. */
export function liveServices(env: Env): Services {
  const supabase: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const issuer = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(
    new URL(env.SUPABASE_JWKS_URL ?? `${issuer}/.well-known/jwks.json`),
    {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
    },
  );

  // Fallback cache for auth.getUser (keyed by token hash, never the token itself).
  const fallbackCache = new Map<string, { at: number; id: Identity }>();

  async function verifyToken(token: string): Promise<Identity | null> {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
      if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
      return { userId: payload.sub, exp: payload.exp };
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // A bad/expired signature is final; only infrastructure failures fall back.
      if (/ERR_JWT_(EXPIRED|CLAIM|INVALID)|ERR_JWS_SIGNATURE/.test(code)) return null;
      log.warn('jwks verify unavailable, falling back to auth.getUser', errInfo(e));
    }
    const key = createHash('sha256').update(token).digest('hex');
    const hit = fallbackCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.id;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    const id = { userId: data.user.id, exp: Math.floor(Date.now() / 1000) + 300 };
    fallbackCache.set(key, { at: Date.now(), id });
    if (fallbackCache.size > 5000) fallbackCache.clear();
    return id;
  }

  let enabledCache: { at: number; on: boolean } | null = null;
  async function survivalEnabled(): Promise<boolean> {
    if (enabledCache && Date.now() - enabledCache.at < 15_000) return enabledCache.on;
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'survival_enabled')
      .maybeSingle();
    const on = data?.value !== false && data?.value !== 'false';
    enabledCache = { at: Date.now(), on };
    return on;
  }

  async function checkEligibility(userId: string): Promise<Eligibility> {
    if (!(await survivalEnabled())) return { ok: false, reason: 'survival_disabled' };
    const [{ data: can, error }, { data: profile }] = await Promise.all([
      supabase.rpc('can_play_survival', { uid: userId }),
      supabase
        .from('profiles')
        .select('id, username, avatar_config')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (error) throw new Error(`eligibility check failed: ${error.message}`);
    if (can !== true || !profile) return { ok: false, reason: 'not_eligible' };
    return {
      ok: true,
      profile: {
        userId,
        username: String(profile.username),
        avatar: (profile.avatar_config as Record<string, unknown>) ?? {},
      },
    };
  }

  let configCache: { at: number; value: Awaited<ReturnType<Services['currentConfig']>> } | null =
    null;
  async function currentConfig() {
    if (configCache && Date.now() - configCache.at < 60_000) return configCache.value;
    const { data, error } = await supabase
      .from('survival_config_versions')
      .select('id, version, config')
      .eq('is_current', true)
      .single();
    if (error || !data) throw new Error('no current survival config');
    const value = {
      id: data.id as string,
      version: data.version as number,
      config: survivalConfigSchema.parse(data.config),
    };
    configCache = { at: Date.now(), value };
    return value;
  }

  const redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
      : null;

  const codes: CodeStore = redis
    ? {
        async reserve(roomId, ttlSec) {
          for (let i = 0; i < 8; i++) {
            const code = randomCode();
            const ok = await redis.set(CODE_PREFIX + code, roomId, { nx: true, ex: ttlSec });
            if (ok === 'OK') return code;
          }
          return null;
        },
        resolve: (code) => redis.get<string>(CODE_PREFIX + code),
        refresh: async (code, ttlSec) => {
          await redis.expire(CODE_PREFIX + code, ttlSec);
        },
        release: async (code) => {
          await redis.del(CODE_PREFIX + code);
        },
      }
    : memoryCodeStore();

  const limiters = new Map<LimitAction, Ratelimit>();
  const limiter: RateLimiter = redis
    ? {
        async check(action, key) {
          let rl = limiters.get(action);
          if (!rl) {
            const c = LIMITS[action];
            rl = new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(c.limit, c.window),
              prefix: `rl:gs:${action}`,
            });
            limiters.set(action, rl);
          }
          try {
            return (await rl.limit(key)).success;
          } catch (e) {
            log.warn('rate limiter unavailable (allowing)', { action, ...errInfo(e) });
            return true;
          }
        },
      }
    : memoryLimiter();

  return { verifyToken, checkEligibility, currentConfig, codes, limiter };
}

/** Single-instance code store (local dev without Upstash, and tests). */
export function memoryCodeStore(): CodeStore {
  const m = new Map<string, { roomId: string; until: number }>();
  const live = (code: string) => {
    const e = m.get(code);
    if (e && e.until < Date.now()) m.delete(code);
    return m.get(code);
  };
  return {
    async reserve(roomId, ttlSec) {
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        if (live(code)) continue;
        m.set(code, { roomId, until: Date.now() + ttlSec * 1000 });
        return code;
      }
      return null;
    },
    resolve: async (code) => live(code)?.roomId ?? null,
    refresh: async (code, ttlSec) => {
      const e = live(code);
      if (e) e.until = Date.now() + ttlSec * 1000;
    },
    release: async (code) => {
      m.delete(code);
    },
  };
}

/** Fixed-window in-memory limiter with the same limits (dev/tests only). */
export function memoryLimiter(): RateLimiter {
  const hits = new Map<string, { start: number; n: number }>();
  const ms = (w: Duration) => {
    const [n, u] = w.split(' ') as [string, string];
    return Number(n) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[u] ?? 1000);
  };
  return {
    async check(action, key) {
      const c = LIMITS[action];
      const k = `${action}:${key}`;
      const now = Date.now();
      const e = hits.get(k);
      if (!e || now - e.start > ms(c.window)) {
        hits.set(k, { start: now, n: 1 });
        return true;
      }
      e.n++;
      return e.n <= c.limit;
    },
  };
}
