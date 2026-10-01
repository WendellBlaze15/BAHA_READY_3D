import type { Duration } from '@upstash/ratelimit';
import { randomCode } from './codes.ts';
import type {
  ChatModeration,
  ChatRow,
  CodeStore,
  LearningRow,
  LimitAction,
  Persistence,
  RateLimiter,
  ReportRow,
} from './types.ts';

/** Section 20.3 limits (keyed by user id). In-room message throttles live in the room. */
export const LIMITS: Record<LimitAction, { limit: number; window: Duration }> = {
  room_create: { limit: 6, window: '10 m' },
  room_join: { limit: 30, window: '10 m' },
  code_lookup: { limit: 20, window: '5 m' },
  report: { limit: 10, window: '1 d' },
  mute: { limit: 60, window: '1 d' },
};

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

export function memoryModeration(): ChatModeration {
  const until = new Map<string, number>();
  const counts = new Map<string, { n: number; since: number }>();
  return {
    mutedUntil: async (u) => until.get(u) ?? 0,
    async applyAutoMute(u, minutesByLevel) {
      const c = counts.get(u);
      const fresh = !c || Date.now() - c.since > 24 * 3600_000;
      const level = fresh ? 1 : c.n + 1;
      counts.set(u, { n: level, since: fresh ? Date.now() : c.since });
      const minutes = minutesByLevel[Math.min(level, minutesByLevel.length) - 1] ?? 10;
      const t = Date.now() + minutes * 60_000;
      until.set(u, t);
      return { until: t, level };
    },
  };
}

/** In-memory persistence for tests; exposes what was written for assertions. */
export function memoryPersistence() {
  let seq = 0;
  const store = {
    runs: new Map<string, { status: string; members: { userId: string; role: string }[] }>(),
    sessions: new Map<string, { runId: string; roomId: string; ended?: string }>(),
    chat: [] as (ChatRow & { id: number })[],
    learning: [] as LearningRow[],
    flags: [] as { userId: string; runId: string | null; reason: string }[],
    reports: [] as (ReportRow & { id: string })[],
    mutes: new Set<string>(),
    blocks: new Set<string>(),
    chatOn: true,
  };
  const db: Persistence = {
    async createRun() {
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      store.runs.set(id, { status: 'lobby', members: [] });
      return id;
    },
    async setRunStatus(runId, status) {
      const r = store.runs.get(runId);
      if (r) r.status = status;
    },
    async setMembers(runId, members) {
      const r = store.runs.get(runId);
      if (r) r.members = members;
    },
    async createSession(runId, roomId) {
      const id = `session-${++seq}`;
      store.sessions.set(id, { runId, roomId });
      return id;
    },
    async endSession(id, reason) {
      const s = store.sessions.get(id);
      if (s) s.ended = reason;
    },
    async insertChat(row) {
      const id = ++seq;
      store.chat.push({ ...row, id });
      return id;
    },
    async insertLearning(rows) {
      store.learning.push(...rows);
    },
    async insertChatFlag(userId, runId, reason) {
      store.flags.push({ userId, runId, reason });
    },
    async createReport(row) {
      const id = `report-${++seq}`;
      store.reports.push({ ...row, id });
      return id;
    },
    async loadRelations(ids) {
      const set = new Set(ids);
      const pairs = (s: Set<string>) =>
        [...s]
          .map((k) => k.split('>') as [string, string])
          .filter(([a, b]) => set.has(a) || set.has(b));
      return { mutes: pairs(store.mutes), blocks: pairs(store.blocks) };
    },
    async setMute(a, b, on) {
      if (on) store.mutes.add(`${a}>${b}`);
      else store.mutes.delete(`${a}>${b}`);
    },
    chatEnabled: async () => store.chatOn,
  };
  return { db, store };
}
