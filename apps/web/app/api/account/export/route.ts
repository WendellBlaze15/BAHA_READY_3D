import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { consumeReauth } from '@/lib/auth/reauth';
import { rateLimit } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/** "Export my data" (RA 10173 right to data portability). Requires step-up re-auth. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { userId, claims } = await requireUser();
  await rateLimit('report_export', userId);
  await consumeReauth(userId);

  const admin = getSupabaseAdmin();
  const q = <T>(p: PromiseLike<{ data: T | null }>) => p.then((r) => r.data);
  const [
    profile,
    settings,
    roles,
    progress,
    attempts,
    achievements,
    tips,
    memberships,
    applications,
    notifications,
    streak,
  ] = await Promise.all([
    q(admin.from('profiles').select('*').eq('id', userId).single()),
    q(admin.from('user_settings').select('*').eq('user_id', userId).single()),
    q(admin.from('user_roles').select('role_id, granted_at').eq('user_id', userId)),
    q(admin.from('player_level_progress').select('*').eq('user_id', userId)),
    q(
      admin
        .from('attempts')
        .select(
          'id, level_id, mode, status, score, stars, duration_ms, npcs_rescued, hazard_hits, started_at, finished_at',
        )
        .eq('user_id', userId),
    ),
    q(
      admin.from('player_achievements').select('achievement_id, unlocked_at').eq('user_id', userId),
    ),
    q(admin.from('player_tips').select('tip_id, unlocked_at, read_at').eq('user_id', userId)),
    q(admin.from('group_members').select('group_id, status, joined_at').eq('user_id', userId)),
    q(
      admin
        .from('facilitator_applications')
        .select('organization, position, status, created_at, reviewed_at')
        .eq('user_id', userId),
    ),
    q(
      admin
        .from('notifications')
        .select('type, title, body, created_at, read_at')
        .eq('user_id', userId),
    ),
    q(admin.from('streaks').select('*').eq('user_id', userId).maybeSingle()),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: userId, email: claims.email },
    profile,
    settings,
    roles,
    progress,
    attempts,
    achievements,
    tips,
    memberships,
    applications,
    notifications,
    streak,
  };

  const path = `${userId}/export-${Date.now()}.json`;
  const { error: upErr } = await admin.storage
    .from('reports')
    .upload(path, JSON.stringify(payload, null, 2), {
      contentType: 'application/json',
      upsert: false,
    });
  if (upErr) throw fail('INTERNAL', 'errors.internal');

  const { data: signed, error: signErr } = await admin.storage
    .from('reports')
    .createSignedUrl(path, 600, {
      download: `baha-ready-data-${new Date().toISOString().slice(0, 10)}.json`,
    });
  if (signErr || !signed) throw fail('INTERNAL', 'errors.internal');
  return json({ url: signed.signedUrl, expiresInSeconds: 600 });
});
