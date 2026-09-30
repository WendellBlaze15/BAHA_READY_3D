// POST /functions/v1/start-attempt  { level_id, mode?, assignment_id?, live_session_id?, device_id? }
// Validates unlock + account state, abandons any previous in-progress attempt, pins the level
// version, and returns a random seed + short-lived signed attempt token.
import { z } from 'zod';
import {
  adminClient,
  broadcast,
  HttpError,
  json,
  rateLimit,
  requireUser,
  serve,
} from '../_shared/http.ts';
import { loadLevelConfig } from '../_shared/content.ts';
import { signAttemptToken } from '../_shared/token.ts';

const body = z
  .object({
    level_id: z.number().int().min(0).max(99),
    mode: z.enum(['normal', 'daily', 'assignment', 'live']).default('normal'),
    assignment_id: z.uuid().optional(),
    live_session_id: z.uuid().optional(),
    device_id: z.string().max(64).optional(),
  })
  .strict();

serve(async (req) => {
  const { userId } = await requireUser(req);
  await rateLimit('start_attempt', userId, 20, '10 m');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError('VALIDATION_ERROR', 'errors.validation');
  const input = parsed.data;
  const admin = adminClient();

  const [{ data: profile }, { data: maint }] = await Promise.all([
    admin.from('profiles').select('status, onboarded_at').eq('id', userId).single(),
    admin.from('system_settings').select('value').eq('key', 'maintenance').maybeSingle(),
  ]);
  if (!profile || profile.status !== 'active') throw new HttpError('FORBIDDEN', 'errors.suspended');
  if (!profile.onboarded_at) throw new HttpError('FORBIDDEN', 'errors.onboarding_required');
  if ((maint?.value as { enabled?: boolean } | null)?.enabled)
    throw new HttpError('MAINTENANCE', 'errors.maintenance');

  const { data: level } = await admin
    .from('levels')
    .select('id, is_active, current_version_id')
    .eq('id', input.level_id)
    .maybeSingle();
  if (!level?.is_active || !level.current_version_id)
    throw new HttpError('NOT_FOUND', 'errors.not_found');

  // Unlock check (tutorial + Signal 1 are always open).
  if (input.level_id > 1) {
    const { data: prog } = await admin
      .from('player_level_progress')
      .select('unlocked')
      .eq('user_id', userId)
      .eq('level_id', input.level_id)
      .maybeSingle();
    if (!prog?.unlocked) throw new HttpError('FORBIDDEN', 'errors.level_locked');
  }

  let dailyDate: string | null = null;
  if (input.mode === 'daily') {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Asia/Manila
    const { data: daily } = await admin
      .from('daily_challenges')
      .select('date, level_id')
      .eq('date', today)
      .maybeSingle();
    if (!daily || daily.level_id !== input.level_id)
      throw new HttpError('CONFLICT', 'errors.daily_mismatch');
    dailyDate = today;
  }

  // One active attempt per user: starting a new one abandons the old (other devices get notified).
  const { data: abandoned } = await admin
    .from('attempts')
    .update({ status: 'abandoned', finished_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'in_progress')
    .select('id, device_id');
  if (abandoned?.some((a) => a.device_id && a.device_id !== input.device_id)) {
    await broadcast(`user:${userId}`, 'attempt_started_elsewhere', {
      device_id: input.device_id ?? null,
    });
  }

  const seedBytes = crypto.getRandomValues(new Uint32Array(1));
  const seed = seedBytes[0]!;
  const { data: attempt, error } = await admin
    .from('attempts')
    .insert({
      user_id: userId,
      level_id: input.level_id,
      level_version_id: level.current_version_id,
      mode: input.mode,
      seed,
      daily_date: dailyDate,
      assignment_id: input.assignment_id ?? null,
      live_session_id: input.live_session_id ?? null,
      device_id: input.device_id ?? null,
    })
    .select('id, started_at')
    .single();
  if (error || !attempt) throw new HttpError('INTERNAL', 'errors.internal');

  const config = await loadLevelConfig(admin, level.current_version_id, dailyDate);
  const { token, exp } = await signAttemptToken(attempt.id, userId);
  return json(req, {
    attempt_id: attempt.id,
    seed: String(seed),
    level_version_id: level.current_version_id,
    config,
    attempt_token: token,
    expires_at: new Date(exp * 1000).toISOString(),
  });
});
