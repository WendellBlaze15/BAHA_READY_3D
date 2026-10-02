import { fail, json, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';

export const runtime = 'nodejs';

/** Chat evidence for ONE report (the RPC writes an audit row for every view). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { supabase } = await requireStaff('survival.reports.review');
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw fail('NOT_FOUND', 'errors.not_found');
  const { data, error } = await supabase.rpc('get_report_chat_evidence', { p_report_id: id });
  if (error) throw fail(error.code === 'P0002' ? 'NOT_FOUND' : 'FORBIDDEN', 'errors.generic');
  return json(data);
});
