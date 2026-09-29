import 'server-only';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { serverEnv } from '@/lib/env/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { fail } from '@/lib/api/http';

export type RateAction =
  | 'otp_request_email'
  | 'otp_request_ip'
  | 'otp_verify'
  | 'signup_ip'
  | 'password_signin'
  | 'start_attempt'
  | 'submit_attempt'
  | 'join_group'
  | 'facilitator_application'
  | 'report_export'
  | 'content_write'
  | 'leaderboard_read'
  | 'weather'
  | 'general';

type LimitCfg = { limit: number; window: Duration };

// Defaults mirror Section 14; super admins can override them in system_settings.rate_limits.
const DEFAULTS: Record<RateAction, LimitCfg> = {
  otp_request_email: { limit: 3, window: '15 m' },
  otp_request_ip: { limit: 10, window: '1 h' },
  otp_verify: { limit: 5, window: '15 m' },
  signup_ip: { limit: 5, window: '1 h' },
  password_signin: { limit: 10, window: '15 m' },
  start_attempt: { limit: 20, window: '10 m' },
  submit_attempt: { limit: 20, window: '10 m' },
  join_group: { limit: 10, window: '1 h' },
  facilitator_application: { limit: 3, window: '1 d' },
  report_export: { limit: 10, window: '1 h' },
  content_write: { limit: 120, window: '1 m' },
  leaderboard_read: { limit: 60, window: '1 m' },
  weather: { limit: 30, window: '1 m' },
  general: { limit: 300, window: '5 m' },
};

let redis: Redis | undefined;
export function getRedis() {
  const env = serverEnv();
  redis ??= new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

let cfgCache: { at: number; cfg: Record<RateAction, LimitCfg> } | null = null;
async function getConfig() {
  if (cfgCache && Date.now() - cfgCache.at < 60_000) return cfgCache.cfg;
  let cfg = DEFAULTS;
  try {
    const { data } = await getSupabaseAdmin()
      .from('system_settings')
      .select('value')
      .eq('key', 'rate_limits')
      .maybeSingle();
    if (data?.value && typeof data.value === 'object') {
      cfg = { ...DEFAULTS, ...(data.value as Partial<Record<RateAction, LimitCfg>>) };
    }
  } catch {
    // keep defaults
  }
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

const limiters = new Map<string, Ratelimit>();
function limiterFor(action: RateAction, cfg: LimitCfg) {
  const key = `${action}:${cfg.limit}:${cfg.window}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
      prefix: `rl:${action}`,
      analytics: false,
    });
    limiters.set(key, l);
  }
  return l;
}

/** Throws RATE_LIMITED (429 + Retry-After) when the key is over its limit. */
export async function rateLimit(action: RateAction, key: string) {
  const cfg = (await getConfig())[action];
  const res = await limiterFor(action, cfg).limit(key.toLowerCase());
  if (!res.success) {
    const retry_after = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
    throw fail('RATE_LIMITED', 'errors.rate_limited', { retry_after });
  }
  return res;
}

// ── OTP lockout: 5 failed verifications → 15 minute lock per email ────
const LOCK_SECONDS = 15 * 60;
const MAX_FAILS = 5;

export async function assertNotLocked(email: string) {
  const ttl = await getRedis().ttl(`otp:lock:${email.toLowerCase()}`);
  if (ttl > 0) throw fail('RATE_LIMITED', 'errors.otp_locked', { retry_after: ttl });
}

/** Records a failed verification; returns attempts left (0 = now locked). */
export async function recordOtpFailure(email: string) {
  const r = getRedis();
  const k = `otp:fail:${email.toLowerCase()}`;
  const n = await r.incr(k);
  if (n === 1) await r.expire(k, LOCK_SECONDS);
  if (n >= MAX_FAILS) {
    await r.set(`otp:lock:${email.toLowerCase()}`, '1', { ex: LOCK_SECONDS });
    await r.del(k);
    return 0;
  }
  return MAX_FAILS - n;
}

export async function clearOtpFailures(email: string) {
  await getRedis().del(`otp:fail:${email.toLowerCase()}`);
}
