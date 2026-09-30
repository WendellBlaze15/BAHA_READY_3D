import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env/server';

export const runtime = 'nodejs';

const SUPPRESS: Record<string, 'hard_bounce' | 'spam' | 'blocked' | 'unsubscribed'> = {
  hard_bounce: 'hard_bounce',
  hardBounce: 'hard_bounce',
  spam: 'spam',
  blocked: 'blocked',
  invalid_email: 'hard_bounce',
  invalid: 'hard_bounce',
  unsubscribed: 'unsubscribed',
};

/** Brevo transactional webhook: auto-suppress hard bounces / spam complaints. */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const secret = serverEnv().EMAIL_WEBHOOK_SECRET;
  const ok =
    token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  if (!ok) return new Response('forbidden', { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    email?: string;
    'message-id'?: string;
  } | null;
  const reason = body?.event ? SUPPRESS[body.event] : undefined;
  if (reason && body?.email) {
    const admin = getSupabaseAdmin();
    await admin
      .from('email_suppressions')
      .upsert({ email: body.email.toLowerCase(), reason }, { onConflict: 'email' });
    if (body['message-id']) {
      await admin
        .from('email_outbox')
        .update({ status: 'suppressed', last_error: body.event })
        .eq('provider_message_id', body['message-id']);
    }
  }
  return new Response('ok');
}
