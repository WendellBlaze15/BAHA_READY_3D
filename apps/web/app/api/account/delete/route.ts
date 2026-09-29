import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { consumeReauth } from '@/lib/auth/reauth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { enqueueEmail } from '@/lib/email/outbox';

export const runtime = 'nodejs';

/**
 * Soft-delete now; the purge_deleted_accounts cron hard-deletes after 30 days.
 * Requires step-up re-auth. The auth user is banned so no session can be refreshed.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId, claims } = await requireUser();
  await consumeReauth(userId);

  if (claims.user_role === 'super_admin') {
    // Never allow the system to lose its last super admin through self-service.
    throw fail('CONFLICT', 'errors.last_super_admin');
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('profiles')
    .update({ status: 'deleted', deleted_at: new Date().toISOString(), leaderboard_visible: false })
    .eq('id', userId);
  if (error) throw fail('INTERNAL', 'errors.internal');

  await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (claims.email) {
    await enqueueEmail({
      to: claims.email,
      template: 'account_deletion_requested',
      userId,
      params: { days: 30 },
    });
  }
  await supabase.auth.signOut({ scope: 'global' });
  return json({ deleted: true, purgeAfterDays: 30 });
});
