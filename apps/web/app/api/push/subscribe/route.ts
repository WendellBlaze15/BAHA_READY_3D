import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertSameOrigin, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { encryptSecret } from '@/lib/push/crypto';

export const runtime = 'nodejs';

const subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
const schema = z
  .object({
    platform: z.enum(['web', 'android', 'ios']).default('web'),
    subscription: subscription.optional(),
    token: z.string().max(500).optional(), // FCM token (native apps)
    device_name: z.string().max(80).optional(),
  })
  .strict();

/** Save (or refresh) this device's push subscription, encrypted at rest. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { userId } = await requireUser();
  await rateLimit('general', userId);
  const body = await parseBody(req, schema);
  const raw = body.subscription ? JSON.stringify(body.subscription) : body.token;
  if (!raw) return json({ saved: false });
  const admin = getSupabaseAdmin();
  // Stable device key (hash of the endpoint/token) so re-subscribing updates instead of duplicating.
  const deviceKey = createHash('sha256').update(raw).digest('base64url').slice(0, 32);
  const { data: existing } = await admin
    .from('user_devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_name', deviceKey)
    .maybeSingle();
  const row = {
    user_id: userId,
    platform: body.platform,
    push_token_encrypted: encryptSecret(raw),
    device_name: deviceKey,
    last_seen_at: new Date().toISOString(),
  };
  if (existing) await admin.from('user_devices').update(row).eq('id', existing.id);
  else await admin.from('user_devices').insert(row);
  return json({ saved: true });
});

/** Remove this device's subscription (push turned off). */
export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const { userId } = await requireUser();
  const body = await parseBody(req, z.object({ subscription }).strict());
  const deviceKey = createHash('sha256')
    .update(JSON.stringify(body.subscription))
    .digest('base64url')
    .slice(0, 32);
  await getSupabaseAdmin()
    .from('user_devices')
    .delete()
    .eq('user_id', userId)
    .eq('device_name', deviceKey);
  return json({ removed: true });
});
