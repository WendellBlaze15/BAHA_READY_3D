import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { survivalConfigSchema } from '@baha/shared/survival';
import type { Env } from '../env.ts';
import { errInfo, log } from '../log.ts';
import { randomCode } from './codes.ts';
import { LIMITS, memoryCodeStore, memoryLimiter, memoryModeration } from './memory.ts';
import type {
  ChatMode,
  ChatModeration,
  CodeStore,
  Eligibility,
  Identity,
  LimitAction,
  Persistence,
  RateLimiter,
  Services,
} from './types.ts';

const CODE_PREFIX = 'survival:code:';

/** Production services: Supabase (service role, server-side only) + Upstash Redis. */
export function liveServices(env: Env): Services {
  const supabase: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const issuer = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(
    new URL(env.SUPABASE_JWKS_URL ?? `${issuer}/.well-known/jwks.json`),
    { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000 },
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

  /** Public system_settings booleans, cached 15 s (kill switches). */
  const settingCache = new Map<string, { at: number; on: boolean }>();
  async function settingOn(key: string): Promise<boolean> {
    const c = settingCache.get(key);
    if (c && Date.now() - c.at < 15_000) return c.on;
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const on = data?.value !== false && data?.value !== 'false';
    settingCache.set(key, { at: Date.now(), on });
    return on;
  }

  async function checkEligibility(userId: string): Promise<Eligibility> {
    if (!(await settingOn('survival_enabled'))) return { ok: false, reason: 'survival_disabled' };
    const [{ data: can, error }, { data: profile }, { data: restricted }, { data: settings }] =
      await Promise.all([
        supabase.rpc('can_play_survival', { uid: userId }),
        supabase
          .from('profiles')
          .select('id, username, avatar_config')
          .eq('id', userId)
          .maybeSingle(),
        supabase.rpc('chat_restricted', { uid: userId }),
        supabase
          .from('user_settings')
          .select('survival_chat_mode')
          .eq('user_id', userId)
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
        chatRestricted: restricted === true,
        chatMode: (settings?.survival_chat_mode as ChatMode | undefined) ?? 'full',
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

  const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  };

  const db: Persistence = {
    async createRun(run) {
      const row = must(
        await supabase
          .from('survival_runs')
          .insert({
            host_id: run.hostId,
            mode: run.mode,
            difficulty: run.difficulty,
            config_version_id: run.configVersionId,
            seed: run.seed,
            status: 'lobby',
          })
          .select('id')
          .single(),
        'createRun',
      );
      return (row as unknown as { id: string }).id;
    },
    async setRunStatus(runId, status) {
      must(
        await supabase
          .from('survival_runs')
          .update({
            status,
            ...(status !== 'lobby' && status !== 'active'
              ? { ended_at: new Date().toISOString() }
              : {}),
          })
          .eq('id', runId),
        'setRunStatus',
      );
    },
    async setMembers(runId, members) {
      must(
        await supabase.from('survival_run_members').upsert(
          members.map((m) => ({
            run_id: runId,
            user_id: m.userId,
            role: m.role,
            status: 'active',
          })),
        ),
        'setMembers',
      );
    },
    async createSession(runId, roomId) {
      const row = must(
        await supabase
          .from('survival_sessions')
          .insert({ run_id: runId, room_id: roomId })
          .select('id')
          .single(),
        'createSession',
      );
      await supabase
        .from('survival_runs')
        .update({ last_session_at: new Date().toISOString() })
        .eq('id', runId);
      return (row as unknown as { id: string }).id;
    },
    async endSession(sessionId, reason) {
      must(
        await supabase
          .from('survival_sessions')
          .update({ ended_at: new Date().toISOString(), end_reason: reason.slice(0, 60) })
          .eq('id', sessionId),
        'endSession',
      );
    },
    async insertChat(row) {
      const r = must(
        await supabase
          .from('survival_chat_messages')
          .insert({
            run_id: row.runId,
            session_id: row.sessionId,
            sender_id: row.senderId,
            body_original: row.bodyOriginal.slice(0, 600),
            body_delivered: row.bodyDelivered,
            status: row.status,
            filter_hits: row.filterHits,
          })
          .select('id')
          .single(),
        'insertChat',
      );
      return Number((r as unknown as { id: number }).id);
    },
    async insertLearning(rows) {
      if (!rows.length) return;
      must(
        await supabase.from('survival_learning_events').insert(
          rows.map((r) => ({
            run_id: r.runId,
            user_id: r.userId,
            day: r.day,
            event_key: r.eventKey,
            is_positive: r.isPositive,
          })),
        ),
        'insertLearning',
      );
    },
    async insertChatFlag(userId, runId, reason) {
      must(
        await supabase
          .from('survival_chat_flags')
          .insert({ user_id: userId, run_id: runId, reason: reason.slice(0, 200) }),
        'insertChatFlag',
      );
    },
    async createReport(row) {
      const r = must(
        await supabase
          .from('survival_reports')
          .insert({
            run_id: row.runId,
            reporter_id: row.reporterId,
            reported_id: row.reportedId,
            reason: row.reason,
            priority: row.priority,
            message_id: row.messageId,
            evidence: row.evidence,
          })
          .select('id')
          .single(),
        'createReport',
      );
      return (r as unknown as { id: string }).id;
    },
    async loadRelations(userIds) {
      if (!userIds.length) return { mutes: [], blocks: [] };
      const list = userIds.join(',');
      const [m, b] = await Promise.all([
        supabase
          .from('survival_mutes')
          .select('muter_id, muted_id')
          .or(`muter_id.in.(${list}),muted_id.in.(${list})`),
        supabase
          .from('survival_blocks')
          .select('blocker_id, blocked_id')
          .or(`blocker_id.in.(${list}),blocked_id.in.(${list})`),
      ]);
      return {
        mutes: (must(m, 'loadMutes') as { muter_id: string; muted_id: string }[]).map((r) => [
          r.muter_id,
          r.muted_id,
        ]),
        blocks: (must(b, 'loadBlocks') as { blocker_id: string; blocked_id: string }[]).map((r) => [
          r.blocker_id,
          r.blocked_id,
        ]),
      };
    },
    async setMute(muterId, mutedId, on) {
      if (on)
        must(
          await supabase.from('survival_mutes').upsert({ muter_id: muterId, muted_id: mutedId }),
          'setMute',
        );
      else
        must(
          await supabase
            .from('survival_mutes')
            .delete()
            .eq('muter_id', muterId)
            .eq('muted_id', mutedId),
          'unsetMute',
        );
    },
    chatEnabled: () => settingOn('survival_chat_enabled'),
  };

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

  // Auto-mute: `chatmute:until:<uid>` (ms, TTL = mute length) + 24 h offense counter.
  const moderation: ChatModeration = redis
    ? {
        async mutedUntil(userId) {
          return Number((await redis.get<number>(`survival:chatmute:until:${userId}`)) ?? 0);
        },
        async applyAutoMute(userId, minutesByLevel) {
          const k = `survival:chatmute:count:${userId}`;
          const level = await redis.incr(k);
          if (level === 1) await redis.expire(k, 24 * 3600);
          const minutes = minutesByLevel[Math.min(level, minutesByLevel.length) - 1] ?? 10;
          const until = Date.now() + minutes * 60_000;
          await redis.set(`survival:chatmute:until:${userId}`, until, { ex: minutes * 60 });
          return { until, level };
        },
      }
    : memoryModeration();

  return { verifyToken, checkEligibility, currentConfig, codes, limiter, db, moderation };
}
