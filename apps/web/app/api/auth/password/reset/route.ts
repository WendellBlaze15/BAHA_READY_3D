import { resetPasswordSchema } from '@baha/shared/auth';
import { assertSameOrigin, clientIp, fail, json, parseBody, route } from '@/lib/api/http';
import { assertNotLocked, clearOtpFailures, rateLimit, recordOtpFailure } from '@/lib/ratelimit';
import { getSupabaseServer } from '@/lib/supabase/server';
import { MIN_PASSWORD_SCORE, passwordScore } from '@/lib/auth/password-strength';
import { nextStepAfterSignIn } from '@/lib/auth/post-signin';

export const runtime = 'nodejs';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await rateLimit('otp_request_ip', clientIp(req));
  const body = await parseBody(req, resetPasswordSchema);

  if (passwordScore(body.password, [body.email]) < MIN_PASSWORD_SCORE) {
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: { password: 'errors.password_weak' },
    });
  }
  await assertNotLocked(body.email);

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email: body.email,
    token: body.token,
    type: 'recovery',
  });
  if (error || !data.session) {
    const left = await recordOtpFailure(body.email);
    if (left === 0) throw fail('RATE_LIMITED', 'errors.otp_locked', { retry_after: 15 * 60 });
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: {
        token: error?.code === 'otp_expired' ? 'errors.otp_expired' : 'errors.otp_invalid',
      },
    });
  }
  await clearOtpFailures(body.email);

  const { error: updErr } = await supabase.auth.updateUser({ password: body.password });
  if (updErr) {
    const weak = updErr.code === 'weak_password' || updErr.code === 'same_password';
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: { password: weak ? 'errors.password_weak' : 'errors.generic' },
    });
  }
  // Revoke every other session after a password reset.
  await supabase.auth.signOut({ scope: 'others' });
  return json(nextStepAfterSignIn(data.session));
});
