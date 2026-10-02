import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { rateLimit } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { gameServer } from '@/lib/survival/server';

export const runtime = 'nodejs';

const DAYS = [1, 3, 7, 30, 0]; // 0 = permanent
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('dismiss'), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal('warn'), note: z.string().trim().min(3).max(1000) }).strict(),
  z
    .object({
      action: z.literal('restrict'),
      scope: z.enum(['chat', 'survival']),
      days: z
        .number()
        .int()
        .refine((d) => DAYS.includes(d)),
      note: z.string().trim().min(3).max(500),
    })
    .strict(),
  z.object({ action: z.literal('escalate'), note: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ action: z.literal('hide'), messageId: z.number().int().min(1) }).strict(),
]);

/**
 * Review a Survival report (Section 17.6): dismiss, warn (in-app + email), restrict chat or
 * Survival (1/3/7/30 days or permanent), escalate (to account suspension), hide a message.
 * Writes go through the reviewer's own session → RLS + audit triggers record the actor.
 */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('survival.reports.review');
  await rateLimit('content_write', userId);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw fail('NOT_FOUND', 'errors.not_found');
  const body = await parseBody(req, schema);
  const { data: report } = await supabase
    .from('survival_reports')
    .select('id, run_id, reported_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!report) throw fail('NOT_FOUND', 'errors.not_found');
  const admin = getSupabaseAdmin();

  if (body.action === 'hide') {
    const { data: runId, error } = await supabase.rpc('admin_hide_survival_chat', {
      p_message_id: body.messageId,
      p_report_id: id,
    });
    if (error) throw fail('NOT_FOUND', 'errors.not_found');
    // Remove it from every screen in a live session too.
    await gameServer(`/admin/runs/${runId}/chat-hidden`, { messageId: body.messageId }).catch(
      () => null,
    );
    return json({ ok: true });
  }

  const status =
    body.action === 'dismiss'
      ? 'dismissed'
      : body.action === 'warn'
        ? 'warned'
        : body.action === 'restrict'
          ? 'restricted'
          : 'escalated';
  const { error } = await supabase
    .from('survival_reports')
    .update({
      status,
      reviewer_id: userId,
      review_note: body.note ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw fail('FORBIDDEN', 'errors.forbidden');

  if (body.action === 'warn') {
    await admin.rpc('notify_user', {
      p_user_id: report.reported_id,
      p_type: 'survival_warning',
      p_title: '⚠️ Paalala mula sa admin · A note from an admin',
      p_body: body.note,
      p_data: { href: '/survival' },
    });
    await admin.rpc('enqueue_email', {
      p_user_id: report.reported_id,
      p_template: 'survival_warning',
      p_params: { note: body.note, href: '/survival' },
    });
  }
  if (body.action === 'restrict') {
    const endsAt = body.days ? new Date(Date.now() + body.days * 86400_000).toISOString() : null;
    const { error: rErr } = await supabase.from('survival_restrictions').insert({
      user_id: report.reported_id,
      scope: body.scope,
      reason: body.note,
      ends_at: endsAt,
      created_by: userId,
    });
    if (rErr) throw fail('FORBIDDEN', 'errors.forbidden');
    await admin.rpc('notify_user', {
      p_user_id: report.reported_id,
      p_type: 'survival_restricted',
      p_title:
        body.scope === 'chat'
          ? '💬 Pansamantalang naka-off ang chat mo · Your chat is paused'
          : '🎮 Pansamantalang hindi ka pwedeng maglaro ng Survival Mode · Survival Mode is paused for you',
      p_body: body.note,
      p_data: { href: '/survival', scope: body.scope, until: endsAt },
    });
    await admin.rpc('enqueue_email', {
      p_user_id: report.reported_id,
      p_template: 'survival_restricted',
      p_params: { scope: body.scope, until: endsAt ?? '', reason: body.note, href: '/survival' },
    });
  }
  return json({ ok: true, status });
});
