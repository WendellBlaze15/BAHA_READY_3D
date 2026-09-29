import { otpVerifySchema } from '@baha/shared/auth';
import { assertSameOrigin, clientIp, fail, json, parseBody, route } from '@/lib/api/http';
import { assertNotLocked, clearOtpFailures, rateLimit, recordOtpFailure } from '@/lib/ratelimit';
import { getSupabaseServer } from '@/lib/supabase/server';
import { nextStepAfterSignIn } from '@/lib/auth/post-signin';
import { enqueueEmail } from '@/lib/email/outbox';

export const runtime = 'nodejs';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await parseBody(req, otpVerifySchema);
  if (body.website)
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: { token: 'errors.otp_invalid' },
    });

  await assertNotLocked(body.email);
  await rateLimit('otp_request_ip', clientIp(req));

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email: body.email,
    token: body.token,
    type: 'email',
  });

  if (error || !data.session) {
    const left = await recordOtpFailure(body.email);
    if (left === 0) {
      await enqueueEmail({ to: body.email, template: 'otp_lockout', params: { minutes: 15 } });
      throw fail('RATE_LIMITED', 'errors.otp_locked', { retry_after: 15 * 60 });
    }
    const expired = error?.code === 'otp_expired';
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: {
        token: expired ? 'errors.otp_expired' : 'errors.otp_invalid',
        attempts_left: String(left),
      },
    });
  }

  await clearOtpFailures(body.email);
  const next = new URL(req.url).searchParams.get('next');
  return json(nextStepAfterSignIn(data.session, next));
});
