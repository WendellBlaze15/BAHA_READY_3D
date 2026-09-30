// POST /functions/v1/approve-facilitator  { application_id, decision: 'approve'|'reject', note? }
// Requires applications.review + MFA. Updates the application, grants/keeps roles, audits,
// notifies (in-app + email) and broadcasts a role refresh to the applicant's devices.
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
import { audit, requireStaff } from '../_shared/authz.ts';

const body = z
  .object({
    application_id: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((b) => b.decision === 'approve' || (b.note && b.note.length >= 3), {
    message: 'note_required',
    path: ['note'],
  });

serve(async (req) => {
  const { userId, claims } = await requireUser(req);
  const admin = adminClient();
  await requireStaff(claims, 'applications.review', admin);
  await rateLimit('content_write', userId, 120, '1 m');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new HttpError('VALIDATION_ERROR', 'errors.validation', {
      fields: { note: 'errors.note_required' },
    });
  }
  const { application_id, decision, note } = parsed.data;

  const { data: app } = await admin
    .from('facilitator_applications')
    .select('*')
    .eq('id', application_id)
    .maybeSingle();
  if (!app) throw new HttpError('NOT_FOUND', 'errors.not_found');
  if (app.status !== 'pending') throw new HttpError('CONFLICT', 'errors.already_reviewed');

  const status = decision === 'approve' ? 'approved' : 'rejected';
  const { error } = await admin
    .from('facilitator_applications')
    .update({
      status,
      reviewer_id: userId,
      review_note: note ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', application_id)
    .eq('status', 'pending');
  if (error) throw new HttpError('INTERNAL', 'errors.internal');

  if (decision === 'approve') {
    await admin
      .from('user_roles')
      .upsert(
        { user_id: app.user_id, role_id: 3, granted_by: userId },
        { onConflict: 'user_id,role_id', ignoreDuplicates: true },
      );
    // Facilitators are off leaderboards unless they opt in again (Section 5.2).
    await admin.from('profiles').update({ leaderboard_visible: false }).eq('id', app.user_id);
  }

  await audit(
    admin,
    userId,
    `application.${status}`,
    'facilitator_applications',
    application_id,
    { applicant: app.user_id, note: note ?? null },
    req,
  );

  await admin.rpc('notify_user', {
    p_user_id: app.user_id,
    p_type: `application_${status}`,
    p_title:
      decision === 'approve'
        ? '✅ Aprubado ka bilang Facilitator · Approved'
        : 'Hindi naaprubahan ang aplikasyon · Application not approved',
    p_body: note ?? '',
    p_data: { href: decision === 'approve' ? '/mfa?next=/facilitator' : '/apply' },
  });
  await admin.rpc('enqueue_email', {
    p_user_id: app.user_id,
    p_template: decision === 'approve' ? 'application_approved' : 'application_rejected',
    p_params: { note: note ?? '', href: decision === 'approve' ? '/facilitator' : '/apply' },
    p_critical: true,
  });

  // Applicant's devices refresh their JWT (new role) without re-login.
  await broadcast(`user:${app.user_id}`, 'role_changed', {
    role: decision === 'approve' ? 'facilitator' : 'player',
  });
  return json(req, { application_id, status });
});
