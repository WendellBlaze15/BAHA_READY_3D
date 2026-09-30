import { z } from 'zod';
import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { enqueueEmail } from '@/lib/email/outbox';

export const runtime = 'nodejs';

const fields = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    organization: z.string().trim().min(2).max(160),
    position: z.string().trim().min(2).max(120),
    contact: z.string().trim().min(5).max(120),
    reason: z.string().trim().min(10).max(2000),
    website: z.string().max(200).optional(),
  })
  .strict();

const MAX_BYTES = 5 * 1024 * 1024;

/** Detects the real type from magic bytes (never trust the file name or client MIME). */
function sniff(buf: Uint8Array): { ext: string; mime: string } | null {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return { ext: 'pdf', mime: 'application/pdf' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

/** Submit a facilitator application (multipart: fields + optional proof file). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId, claims } = await requireUser({
    onboarded: true,
    permission: 'facilitator.apply',
  });
  await rateLimit('facilitator_application', userId);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw fail('VALIDATION_ERROR', 'errors.validation');
  }
  const raw = Object.fromEntries(
    ['full_name', 'organization', 'position', 'contact', 'reason', 'website']
      .map((k) => [k, form.get(k)])
      .filter(([, v]) => typeof v === 'string'),
  );
  const parsed = fields.safeParse(raw);
  if (!parsed.success) {
    const f: Record<string, string> = {};
    for (const i of parsed.error.issues) f[String(i.path[0])] = 'errors.validation';
    throw fail('VALIDATION_ERROR', 'errors.validation', { fields: f });
  }
  if (parsed.data.website) return json({ submitted: true }); // honeypot
  const { full_name, organization, position, contact, reason } = parsed.data;
  const data = { full_name, organization, position, contact, reason };

  let proofPath: string | null = null;
  const file = form.get('proof');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES)
      throw fail('VALIDATION_ERROR', 'errors.validation', {
        fields: { proof: 'errors.file_too_large' },
      });
    const buf = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(buf);
    if (!kind)
      throw fail('VALIDATION_ERROR', 'errors.validation', {
        fields: { proof: 'errors.file_type' },
      });
    proofPath = `${userId}/${crypto.randomUUID()}.${kind.ext}`;
    const { error } = await getSupabaseAdmin()
      .storage.from('applications')
      .upload(proofPath, buf, { contentType: kind.mime });
    if (error) throw fail('INTERNAL', 'errors.internal');
  }

  // Insert as the user so RLS enforces ownership + pending status.
  const { error } = await supabase
    .from('facilitator_applications')
    .insert({ ...data, proof_path: proofPath });
  if (error) {
    if (error.code === '23505') throw fail('CONFLICT', 'errors.application_pending');
    throw fail('FORBIDDEN', 'errors.forbidden');
  }

  const admin = getSupabaseAdmin();
  if (claims.email) {
    await enqueueEmail({
      to: claims.email,
      template: 'application_received',
      userId,
      params: { organization: data.organization },
    });
  }
  // Tell reviewers (admins + super admins).
  const { data: reviewers } = await admin
    .from('user_roles')
    .select('user_id')
    .in('role_id', [4, 5]);
  for (const r of reviewers ?? []) {
    await admin.rpc(
      'notify_user' as never,
      {
        p_user_id: r.user_id,
        p_type: 'application_new',
        p_title: 'Bagong aplikasyon · New facilitator application',
        p_body: `${data.full_name} — ${data.organization}`,
        p_data: { href: '/admin/applications' },
      } as never,
    );
    const { data: u } = await admin.auth.admin.getUserById(r.user_id);
    if (u.user?.email) {
      await enqueueEmail({
        to: u.user.email,
        template: 'application_received_admin',
        userId: r.user_id,
        params: {
          full_name: data.full_name,
          organization: data.organization,
          href: '/admin/applications',
        },
      });
    }
  }
  return json({ submitted: true });
});
