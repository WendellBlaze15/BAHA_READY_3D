'use client';

import type { AttemptResult, ClientSummary, GameEvent } from '@baha/shared/game';
import type { LevelConfig } from '@baha/shared/level-config';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { ApiClientError } from '@/lib/api/client';
import { getDb, type PendingSubmission } from '@/lib/offline/db';

export type StartResponse = {
  attempt_id: string;
  seed: string;
  level_version_id: string;
  config: LevelConfig;
  attempt_token: string;
  expires_at: string;
};

export type SubmitResponse = {
  result: AttemptResult;
  new_tips?: { id: string; slug: string; title_fil: string; title_en: string }[];
  new_achievements?: { key: string; name_fil: string; name_en: string; icon_key: string }[];
  unlocked_level?: number | null;
  flagged?: boolean;
  replayed?: boolean;
};

type Envelope<T> = {
  data: T | null;
  error: { code: string; message: string; retry_after?: number } | null;
};

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowser().functions.invoke<Envelope<T>>(name, { body });
  if (error) {
    // FunctionsHttpError carries the response; surface our envelope's code when present.
    const ctx = (error as { context?: Response }).context;
    const env = ctx ? ((await ctx.json().catch(() => null)) as Envelope<T> | null) : null;
    if (env?.error) {
      throw new ApiClientError({
        code: env.error.code as ApiClientError['code'],
        message: env.error.message,
        retry_after: env.error.retry_after,
      });
    }
    throw new ApiClientError({ code: 'INTERNAL', message: 'errors.generic' });
  }
  if (!data?.data) throw new ApiClientError({ code: 'INTERNAL', message: 'errors.generic' });
  return data.data;
}

export function deviceId() {
  try {
    let id = localStorage.getItem('baha.device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('baha.device', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export function startAttempt(input: {
  level_id: number;
  mode?: 'normal' | 'daily' | 'assignment' | 'live';
  assignment_id?: string;
  live_session_id?: string;
}) {
  return invoke<StartResponse>('start-attempt', { ...input, device_id: deviceId() });
}

const isNetworkError = (e: unknown) =>
  !(e instanceof ApiClientError) || (e.code === 'INTERNAL' && !navigator.onLine);

/**
 * Submits a finished attempt. If offline (or the network fails) the submission is queued in
 * IndexedDB with its idempotency key and retried later — retries can never double-count.
 */
export async function submitAttempt(
  p: Omit<PendingSubmission, 'created_at' | 'tries' | 'next_try_at'>,
): Promise<SubmitResponse | { queued: true }> {
  const payload = {
    attempt_id: p.attempt_id,
    attempt_token: p.attempt_token,
    events: p.events,
    client_summary: p.client_summary,
    idempotency_key: p.idempotency_key,
  };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await queue(p);
    return { queued: true };
  }
  try {
    return await invoke<SubmitResponse>('submit-attempt', payload);
  } catch (e) {
    if (isNetworkError(e)) {
      await queue(p);
      return { queued: true };
    }
    throw e;
  }
}

async function queue(p: Omit<PendingSubmission, 'created_at' | 'tries' | 'next_try_at'>) {
  await getDb()?.pending_submissions.put({
    ...p,
    created_at: Date.now(),
    tries: 0,
    next_try_at: Date.now(),
  });
}

let flushing = false;
/** Retry queued submissions with exponential backoff. Returns how many were saved. */
export async function flushPendingSubmissions() {
  const db = getDb();
  if (!db || flushing || !navigator.onLine) return 0;
  flushing = true;
  let saved = 0;
  try {
    const due = await db.pending_submissions
      .where('next_try_at')
      .belowOrEqual(Date.now())
      .toArray();
    for (const p of due) {
      try {
        await invoke<SubmitResponse>('submit-attempt', {
          attempt_id: p.attempt_id,
          attempt_token: p.attempt_token,
          events: p.events,
          client_summary: p.client_summary,
          idempotency_key: p.idempotency_key,
        });
        await db.pending_submissions.delete(p.idempotency_key);
        saved++;
      } catch (e) {
        const permanent =
          e instanceof ApiClientError &&
          ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR'].includes(e.code);
        if (permanent || p.tries >= 8) await db.pending_submissions.delete(p.idempotency_key);
        else {
          const tries = p.tries + 1;
          await db.pending_submissions.update(p.idempotency_key, {
            tries,
            next_try_at: Date.now() + Math.min(30 * 60_000, 2 ** tries * 5000),
          });
        }
      }
    }
  } finally {
    flushing = false;
  }
  return saved;
}

// ── Guest play (local save) ────────────────────────────────────────────

export async function saveGuestAttempt(a: {
  level_id: number;
  seed: string;
  events: GameEvent[];
  client_summary: ClientSummary;
}) {
  const db = getDb();
  if (!db) return;
  await db.guest_attempts.add({ ...a, created_at: Date.now() });
  const prev = await db.guest_progress.get(a.level_id);
  await db.guest_progress.put({
    level_id: a.level_id,
    best_score: Math.max(prev?.best_score ?? 0, a.client_summary.score),
    best_stars: Math.max(prev?.best_stars ?? 0, a.client_summary.stars),
  });
}

/** After sign-up: server re-validates each guest attempt and imports the valid ones. */
export async function migrateGuestProgress() {
  const db = getDb();
  if (!db) return null;
  const attempts = await db.guest_attempts.orderBy('created_at').reverse().limit(10).toArray();
  if (!attempts.length) return null;
  const res = await invoke<{ imported: unknown[]; discarded: number }>('guest-migrate', {
    attempts: attempts.map((a) => ({
      level_id: a.level_id,
      seed: a.seed,
      events: a.events,
      client_summary: a.client_summary,
    })),
  });
  await db.guest_attempts.clear();
  await db.guest_progress.clear();
  return res;
}
