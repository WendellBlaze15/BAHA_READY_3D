import { forgotPasswordSchema } from '@baha/shared/auth';
import { assertSameOrigin, clientIp, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** Sends a password-recovery code. Always answers the same way (no account enumeration). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await parseBody(req, forgotPasswordSchema);
  if (body.website) return json({ sent: true, cooldown: 60 });

  await rateLimit('otp_request_ip', clientIp(req));
  await rateLimit('otp_request_email', body.email);

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(body.email);
  if (error && error.status !== 400 && error.status !== 422 && error.status !== 429) {
    console.error('[password/forgot] supabase error', error.code, error.status);
  }
  return json({ sent: true, cooldown: 60 });
});
