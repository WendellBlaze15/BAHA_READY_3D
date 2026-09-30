// POST /functions/v1/send-email  (called by the DB trigger on email_outbox INSERT, and by the
// retry cron with { mode: 'retry' }). Authenticated with the x-webhook-secret header.
// Sends through the Brevo Transactional Email API using the pre-built bilingual templates.
import { adminClient } from '../_shared/http.ts';
import templates from './templates.json' with { type: 'json' };

const SECRET = Deno.env.get('EMAIL_WEBHOOK_SECRET') ?? '';
const BREVO_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? '';
const SENDER_NAME = Deno.env.get('BREVO_SENDER_NAME') ?? 'Baha Ready';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
const MAX_ATTEMPTS = 5;

type Row = {
  id: string;
  to_email: string;
  template_key: string;
  params: Record<string, unknown>;
  locale: string;
  status: string;
  attempts: number;
};

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length || !a) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function send(row: Row) {
  const admin = adminClient();
  const tpl = (templates as Record<string, { id: number }>)[row.template_key];
  if (!tpl) {
    await admin
      .from('email_outbox')
      .update({ status: 'failed', last_error: 'unknown template' })
      .eq('id', row.id);
    return 'failed';
  }
  const prefix = row.locale === 'en' ? '/en' : '';
  const href =
    typeof row.params.href === 'string' && row.params.href.startsWith('/')
      ? row.params.href
      : '/home';
  const params = {
    ...row.params,
    url: `${APP_URL}${prefix}${href}`,
    settings_url: `${APP_URL}${prefix}/settings`,
    app_url: APP_URL,
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: row.to_email }],
      templateId: tpl.id,
      params,
      tags: [`baha-${row.template_key}`],
    }),
  });
  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    await admin
      .from('email_outbox')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        attempts: row.attempts + 1,
        provider_message_id: body.messageId ?? null,
        last_error: null,
      })
      .eq('id', row.id);
    return 'sent';
  }
  const attempts = row.attempts + 1;
  const err = (await res.text()).slice(0, 300);
  // Exponential backoff: 1, 2, 4, 8 minutes; then give up (visible to admins).
  await admin
    .from('email_outbox')
    .update({
      attempts,
      last_error: `HTTP ${res.status}: ${err}`,
      status: attempts >= MAX_ATTEMPTS || res.status === 400 ? 'failed' : 'queued',
      next_attempt_at: new Date(Date.now() + 2 ** (attempts - 1) * 60_000).toISOString(),
    })
    .eq('id', row.id);
  return 'retry';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('not found', { status: 404 });
  if (!timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', SECRET))
    return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const admin = adminClient();

  let rows: Row[] = [];
  if (body.mode === 'retry') {
    const { data } = await admin
      .from('email_outbox')
      .select('*')
      .eq('status', 'queued')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at')
      .limit(25);
    rows = (data ?? []) as Row[];
  } else if (body.record?.id) {
    const { data } = await admin
      .from('email_outbox')
      .select('*')
      .eq('id', body.record.id)
      .eq('status', 'queued')
      .maybeSingle();
    if (data) rows = [data as Row];
  }

  const results: Record<string, number> = {};
  for (const row of rows) {
    // Claim the row first so the trigger and the retry cron never double-send.
    const { data: claimed } = await admin
      .from('email_outbox')
      .update({ next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued')
      .lte('next_attempt_at', new Date(Date.now() + 1000).toISOString())
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    const r = await send(row);
    results[r] = (results[r] ?? 0) + 1;
  }
  return Response.json({ processed: rows.length, results });
});
