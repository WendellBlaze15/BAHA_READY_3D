import { fail, route } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/** Redirects the requester to a 10-minute signed URL for their own report. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { supabase, userId } = await requireUser();
  await rateLimit('report_export', userId);
  const { id } = await ctx.params;
  // RLS: requesters can only read their own jobs.
  const { data: job } = await supabase
    .from('report_jobs')
    .select('file_path, status')
    .eq('id', id)
    .maybeSingle();
  if (!job?.file_path || job.status !== 'ready') throw fail('NOT_FOUND', 'errors.not_found');
  const { data } = await getSupabaseAdmin()
    .storage.from('reports')
    .createSignedUrl(job.file_path, 600, { download: true });
  if (!data?.signedUrl) throw fail('INTERNAL', 'errors.internal');
  return Response.redirect(data.signedUrl, 303);
});
