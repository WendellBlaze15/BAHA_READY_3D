import { fail, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/** Reviewer-only: redirect to a 5-minute signed URL for an application's proof file. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { supabase, userId } = await requireStaff('applications.review');
  await rateLimit('general', userId);
  const { id } = await ctx.params;
  const { data: app } = await supabase
    .from('facilitator_applications')
    .select('proof_path')
    .eq('id', id)
    .maybeSingle();
  if (!app?.proof_path) throw fail('NOT_FOUND', 'errors.not_found');
  const { data } = await getSupabaseAdmin()
    .storage.from('applications')
    .createSignedUrl(app.proof_path, 300);
  if (!data?.signedUrl) throw fail('INTERNAL', 'errors.internal');
  return Response.redirect(data.signedUrl, 303);
});
