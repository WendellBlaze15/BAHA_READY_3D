// POST /functions/v1/submit-attempt
// { attempt_id, attempt_token, events[], client_summary, idempotency_key }
// Validates the token, replays the event log with the shared deterministic scoring, flags
// cheating, and records progress/unlocks/achievements/tips atomically. Idempotent.
import { z } from 'zod';
import { adminClient, HttpError, json, rateLimit, requireUser, serve } from '../_shared/http.ts';
import { loadContent, loadLevelConfig } from '../_shared/content.ts';
import { verifyAttemptToken } from '../_shared/token.ts';
import { scoreAndFinalize } from '../_shared/finalize.ts';
import {
  clientSummarySchema,
  eventLogSchema,
  MAX_EVENT_BYTES,
} from '../_shared/shared/game/index.ts';

const body = z
  .object({
    attempt_id: z.uuid(),
    attempt_token: z.string().min(20).max(400),
    events: eventLogSchema,
    client_summary: clientSummarySchema.optional(),
    idempotency_key: z.uuid(),
  })
  .strict();

serve(async (req) => {
  const { userId } = await requireUser(req);
  await rateLimit('submit_attempt', userId, 20, '10 m');

  const raw = await req.text();
  if (raw.length > MAX_EVENT_BYTES + 8192)
    throw new HttpError('VALIDATION_ERROR', 'errors.validation', {
      fields: { events: 'too_large' },
    });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new HttpError('VALIDATION_ERROR', 'errors.validation');
  }
  const parsed = body.safeParse(parsedJson);
  if (!parsed.success) throw new HttpError('VALIDATION_ERROR', 'errors.validation');
  const input = parsed.data;
  const admin = adminClient();

  // Idempotent retries (offline queue): return the stored result.
  const { data: existing } = await admin
    .from('attempts')
    .select('id, user_id, summary, status')
    .eq('idempotency_key', input.idempotency_key)
    .maybeSingle();
  if (existing) {
    if (existing.user_id !== userId) throw new HttpError('FORBIDDEN', 'errors.forbidden');
    return json(req, { result: existing.summary, replayed: true });
  }

  const { data: attempt } = await admin
    .from('attempts')
    .select('id, user_id, status, seed, level_id, level_version_id, daily_date')
    .eq('id', input.attempt_id)
    .maybeSingle();
  if (!attempt || attempt.user_id !== userId) throw new HttpError('NOT_FOUND', 'errors.not_found');
  if (attempt.status !== 'in_progress') throw new HttpError('CONFLICT', 'errors.attempt_closed');
  if (!(await verifyAttemptToken(input.attempt_token, attempt.id, userId))) {
    throw new HttpError('FORBIDDEN', 'errors.attempt_token_invalid');
  }

  // Claim the idempotency key before scoring so concurrent retries can't double-count.
  const { error: claimErr } = await admin
    .from('attempts')
    .update({ idempotency_key: input.idempotency_key })
    .eq('id', attempt.id)
    .is('idempotency_key', null);
  if (claimErr) throw new HttpError('CONFLICT', 'errors.conflict');

  const [config, content] = await Promise.all([
    loadLevelConfig(admin, attempt.level_version_id, attempt.daily_date),
    loadContent(admin),
  ]);
  const { result, extras } = await scoreAndFinalize({
    admin,
    attemptId: attempt.id,
    config,
    content,
    seed: String(attempt.seed),
    events: input.events,
    clientSummary: input.client_summary,
  });

  await admin.from('attempt_events').insert({
    attempt_id: attempt.id,
    events: input.events,
    byte_size: raw.length,
  });

  return json(req, { result, ...extras, level_id: attempt.level_id });
});
