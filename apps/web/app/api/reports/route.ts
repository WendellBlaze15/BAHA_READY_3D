import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toPdf, type GroupReport } from '@/lib/reports/group-report';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({ type: z.enum(['group_csv', 'group_pdf']), group_id: z.uuid() }).strict();

/**
 * Creates a report job and generates it server-side. The job row changes status via Realtime,
 * so the requester sees "ready" without refreshing; the file lives in the private `reports`
 * bucket and is downloaded through a 10-minute signed URL.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId, claims } = await requireUser({ permission: 'reports.export' });
  await rateLimit('report_export', userId);
  const { type, group_id } = await parseBody(req, schema);

  const { data: allowed } = await supabase.rpc('can_view_group', { gid: group_id });
  if (!allowed) throw fail('FORBIDDEN', 'errors.forbidden');

  const admin = getSupabaseAdmin();
  const { data: job, error: jobErr } = await admin
    .from('report_jobs')
    .insert({ requested_by: userId, type, params: { group_id }, status: 'running' })
    .select('id')
    .single();
  if (jobErr || !job) throw fail('INTERNAL', 'errors.internal');

  try {
    const [{ data: group }, { data: roster }, { data: overview }] = await Promise.all([
      admin.from('groups').select('name').eq('id', group_id).single(),
      supabase.rpc('get_group_roster', { p_group_id: group_id }),
      supabase.rpc('facilitator_overview', { p_group_id: group_id }),
    ]);
    const ids = (roster ?? []).map((r) => r.user_id);
    const { data: progress } = ids.length
      ? await admin
          .from('player_level_progress')
          .select('user_id, best_score, attempts_count')
          .in('user_id', ids)
      : { data: [] };
    const agg = new Map<string, { best: number; attempts: number }>();
    for (const p of progress ?? []) {
      const cur = agg.get(p.user_id) ?? { best: 0, attempts: 0 };
      agg.set(p.user_id, {
        best: Math.max(cur.best, p.best_score),
        attempts: cur.attempts + p.attempts_count,
      });
    }
    const ov = overview as unknown as {
      members: number;
      avg_stars: number | null;
      completion_rate: number | null;
      top_mistakes: { key: string }[];
    };
    const report: GroupReport = {
      groupName: group?.name ?? 'Group',
      generatedAt: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
      rows: (roster ?? []).map((r) => ({
        username: r.username,
        status: r.status,
        levels_done: r.levels_done,
        stars: r.stars,
        attempts: agg.get(r.user_id)?.attempts ?? 0,
        best_score: agg.get(r.user_id)?.best ?? 0,
        last_played: r.last_played,
      })),
      summary: {
        members: ov?.members ?? 0,
        avgStars: ov?.avg_stars ?? null,
        completion: ov?.completion_rate ?? null,
        topMistakes: (ov?.top_mistakes ?? []).map((m) => m.key),
      },
    };
    const isPdf = type === 'group_pdf';
    const body = isPdf ? await toPdf(report) : Buffer.from(toCsv(report), 'utf8');
    const path = `${userId}/report-${job.id}.${isPdf ? 'pdf' : 'csv'}`;
    const { error: upErr } = await admin.storage
      .from('reports')
      .upload(path, body, { contentType: isPdf ? 'application/pdf' : 'text/csv' });
    if (upErr) throw upErr;

    await admin
      .from('report_jobs')
      .update({ status: 'ready', file_path: path, completed_at: new Date().toISOString() })
      .eq('id', job.id);
    await admin.rpc('notify_user', {
      p_user_id: userId,
      p_type: 'report_ready',
      p_title: '📄 Handa na ang report · Report ready',
      p_body: report.groupName,
      p_data: { href: '/facilitator/reports' },
    });
    if (claims.email)
      await admin.rpc('enqueue_email', {
        p_user_id: userId,
        p_template: 'report_ready',
        p_params: { group: report.groupName, href: '/facilitator/reports' },
      });
    return json({ job_id: job.id, status: 'ready' });
  } catch (e) {
    await admin
      .from('report_jobs')
      .update({ status: 'failed', error: (e as Error).message?.slice(0, 300) })
      .eq('id', job.id);
    throw fail('INTERNAL', 'errors.internal');
  }
});
