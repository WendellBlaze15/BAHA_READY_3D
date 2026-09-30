import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireStaff } from '@/lib/auth/staff';
import { consumeReauth } from '@/lib/auth/reauth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { enqueueEmail } from '@/lib/email/outbox';
import { serverBroadcast } from '@/lib/realtime/server-broadcast';

export const runtime = 'nodejs';

const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('suspend'),
      reason: z.string().trim().min(3).max(500),
      days: z.number().int().min(0).max(3650),
    })
    .strict(),
  z.object({ action: z.literal('unsuspend') }).strict(),
  z.object({ action: z.literal('signout') }).strict(),
  z.object({ action: z.literal('reset_mfa') }).strict(),
]);

/** Suspend / unsuspend / force sign-out / reset MFA (Section 8.4 A5). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('users.manage');
  await rateLimit('content_write', userId);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw fail('NOT_FOUND', 'errors.not_found');
  const body = await parseBody(req, schema);
  const admin = getSupabaseAdmin();
  const { data: target } = await admin.auth.admin.getUserById(id);
  if (!target.user) throw fail('NOT_FOUND', 'errors.not_found');
  const email = target.user.email;

  if (body.action === 'suspend' || body.action === 'unsuspend') {
    const until =
      body.action === 'suspend' && body.days > 0
        ? new Date(Date.now() + body.days * 86400_000).toISOString()
        : null;
    // RPC runs as the admin → audit trigger records the actor; it also blocks acting on super admins.
    const { error } = await supabase.rpc('admin_set_user_status', {
      p_user_id: id,
      p_status: body.action === 'suspend' ? 'suspended' : 'active',
      p_reason: body.action === 'suspend' ? body.reason : undefined,
      p_until: until ?? undefined,
    });
    if (error)
      throw fail(
        error.message.includes('FORBIDDEN') ? 'FORBIDDEN' : 'VALIDATION_ERROR',
        'errors.forbidden',
      );
    await admin.auth.admin.updateUserById(id, {
      ban_duration:
        body.action === 'suspend' ? (body.days > 0 ? `${body.days * 24}h` : '876000h') : 'none',
    });
    if (body.action === 'suspend') {
      await admin.rpc('admin_revoke_sessions', { p_user_id: id });
      await serverBroadcast(`user:${id}`, 'session_revoked', {});
    }
    if (email) {
      await enqueueEmail({
        to: email,
        template: body.action === 'suspend' ? 'account_suspended' : 'account_restored',
        userId: id,
        params:
          body.action === 'suspend' ? { reason: body.reason, days: body.days || 'indefinite' } : {},
      });
    }
    return json({ ok: true });
  }

  // Force sign-out and MFA reset are logged explicitly (they don't touch audited tables).
  const act = async (action: string) =>
    admin
      .from('audit_logs')
      .insert({
        actor_id: userId,
        actor_role: 'admin',
        action,
        target_type: 'auth.users',
        target_id: id,
        metadata: {},
      });

  if (body.action === 'signout') {
    await admin.rpc('admin_revoke_sessions', { p_user_id: id });
    await serverBroadcast(`user:${id}`, 'session_revoked', {});
    await act('user.force_signout');
    return json({ ok: true });
  }

  // reset_mfa: sensitive → fresh step-up re-auth required (Section 12).
  await consumeReauth(userId);
  const { data: roles } = await admin.from('user_roles').select('role_id').eq('user_id', id);
  if (roles?.some((r) => r.role_id === 5)) throw fail('FORBIDDEN', 'errors.forbidden');
  await admin.rpc('admin_reset_mfa', { p_user_id: id });
  await serverBroadcast(`user:${id}`, 'session_revoked', {});
  await act('user.reset_mfa');
  if (email)
    await enqueueEmail({
      to: email,
      template: 'new_device_signin',
      userId: id,
      params: { event: 'mfa_reset' },
    });
  return json({ ok: true });
});
