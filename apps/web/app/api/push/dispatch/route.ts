import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env/server';
import { publicEnv } from '@/lib/env/client';
import { decryptSecret } from '@/lib/push/crypto';

export const runtime = 'nodejs';

/**
 * Called by the database (pg_net) right after a notification row is inserted.
 * Fans out Web Push to the user's subscribed browsers, honoring their push preference.
 */
export async function POST(req: Request) {
  const env = serverEnv();
  const given = req.headers.get('x-webhook-secret') ?? '';
  if (
    given.length !== env.EMAIL_WEBHOOK_SECRET.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(env.EMAIL_WEBHOOK_SECRET))
  ) {
    return new Response('forbidden', { status: 403 });
  }
  if (!env.VAPID_PRIVATE_KEY || !publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
    return Response.json({ sent: 0, reason: 'vapid-missing' });

  const { notification_id } = (await req.json().catch(() => ({}))) as { notification_id?: string };
  if (!notification_id) return new Response('bad request', { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: n } = await admin
    .from('notifications')
    .select('id, user_id, title, body, data')
    .eq('id', notification_id)
    .maybeSingle();
  if (!n) return Response.json({ sent: 0 });

  const { data: settings } = await admin
    .from('user_settings')
    .select('notifications')
    .eq('user_id', n.user_id)
    .maybeSingle();
  if ((settings?.notifications as { push?: boolean } | null)?.push === false)
    return Response.json({ sent: 0, reason: 'opted-out' });

  webpush.setVapidDetails(
    `mailto:${env.BREVO_SENDER_EMAIL}`,
    publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  const { data: devices } = await admin
    .from('user_devices')
    .select('id, push_token_encrypted')
    .eq('user_id', n.user_id)
    .eq('platform', 'web');
  const payload = JSON.stringify({
    id: n.id,
    title: n.title,
    body: n.body,
    href: (n.data as { href?: string } | null)?.href ?? '/notifications',
  });

  let sent = 0;
  for (const d of devices ?? []) {
    if (!d.push_token_encrypted) continue;
    try {
      const sub = JSON.parse(decryptSecret(d.push_token_encrypted)) as webpush.PushSubscription;
      await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'normal' });
      sent++;
    } catch (e) {
      // 404/410: the browser dropped the subscription → forget it.
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410)
        await admin.from('user_devices').delete().eq('id', d.id);
    }
  }
  return Response.json({ sent });
}
