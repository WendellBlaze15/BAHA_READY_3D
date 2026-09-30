import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { consumeReauth } from '@/lib/auth/reauth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { enqueueEmail } from '@/lib/email/outbox';
import { serverBroadcast } from '@/lib/realtime/server-broadcast';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const schema = z.object({ user_id: z.uuid(), make_admin: z.boolean() }).strict();

/** Promote/demote admins: super admin + MFA + fresh step-up re-auth (Section 8.5 S1). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId, claims } = await requireStaff('admins.manage');
  await rateLimit('general', userId);
  if (claims.user_role !== 'super_admin') throw fail('FORBIDDEN', 'errors.forbidden');
  const body = await parseBody(req, schema);
  await consumeReauth(userId);

  const { error } = await supabase.rpc('super_set_admin', {
    p_user_id: body.user_id,
    p_make_admin: body.make_admin,
  });
  if (error) throw fail('FORBIDDEN', 'errors.forbidden');

  const admin = getSupabaseAdmin();
  await serverBroadcast(`user:${body.user_id}`, 'role_changed', {
    role: body.make_admin ? 'admin' : 'player',
  });
  const template = body.make_admin ? 'admin_promoted' : 'admin_demoted';
  const { data: target } = await admin.auth.admin.getUserById(body.user_id);
  if (target.user?.email)
    await enqueueEmail({ to: target.user.email, template, userId: body.user_id });
  // Other super admins are informed too.
  const { data: supers } = await admin.from('user_roles').select('user_id').eq('role_id', 5);
  for (const s of supers ?? []) {
    if (s.user_id === userId) continue;
    const { data: u } = await admin.auth.admin.getUserById(s.user_id);
    if (u.user?.email)
      await enqueueEmail({
        to: u.user.email,
        template,
        userId: s.user_id,
        params: { target: body.user_id },
      });
  }
  return json({ ok: true });
});
