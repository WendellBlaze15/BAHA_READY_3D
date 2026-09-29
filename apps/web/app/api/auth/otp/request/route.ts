import { otpRequestSchema } from '@baha/shared/auth';
import { assertSameOrigin, clientIp, fail, json, parseBody, route } from '@/lib/api/http';
import { assertNotLocked, rateLimit } from '@/lib/ratelimit';
import { isDisposableEmail } from '@/lib/auth/disposable';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const OK = { sent: true, cooldown: 60 };

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await parseBody(req, otpRequestSchema);

  // Honeypot filled → pretend success so bots learn nothing.
  if (body.website) return json(OK);

  if (isDisposableEmail(body.email)) {
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: { email: 'errors.disposable_email' },
    });
  }

  const ip = clientIp(req);
  await assertNotLocked(body.email);
  await rateLimit('otp_request_ip', ip);
  await rateLimit('otp_request_email', body.email);
  if (body.mode === 'signup') await rateLimit('signup_ip', ip);

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: body.email,
    options: { shouldCreateUser: body.mode === 'signup', data: { language: body.locale } },
  });

  if (error) {
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
      throw fail('RATE_LIMITED', 'errors.rate_limited', { retry_after: 60 });
    }
    // Unknown email on sign-in (or signups disabled): same response as success,
    // so the endpoint cannot be used to discover which emails have accounts.
    if (
      error.code === 'otp_disabled' ||
      error.code === 'signup_disabled' ||
      error.status === 422 ||
      error.status === 400
    ) {
      return json(OK);
    }
    console.error('[otp/request] supabase error', error.code, error.status);
    throw fail('INTERNAL', 'errors.email_send_failed');
  }
  return json(OK);
});
