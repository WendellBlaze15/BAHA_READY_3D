import { reauthSchema } from '@baha/shared/auth';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { assertNotLocked, clearOtpFailures, rateLimit, recordOtpFailure } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';
import { markReauthenticated } from '@/lib/auth/reauth';

export const runtime = 'nodejs';

/**
 * Step-up re-authentication (fresh proof within 5 minutes) for sensitive actions.
 * Methods: email OTP (request + verify), TOTP code, or password.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, claims, userId } = await requireUser();
  const body = await parseBody(req, reauthSchema);
  const email = claims.email;

  switch (body.method) {
    case 'otp_request': {
      if (!email || email.endsWith('@bahaready.internal'))
        throw fail('CONFLICT', 'errors.reauth_use_totp');
      await rateLimit('otp_request_email', email);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error?.status === 429)
        throw fail('RATE_LIMITED', 'errors.rate_limited', { retry_after: 60 });
      return json({ sent: true, cooldown: 60 });
    }
    case 'otp': {
      if (!email) throw fail('CONFLICT', 'errors.reauth_use_totp');
      await assertNotLocked(email);
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: body.token,
        type: 'email',
      });
      if (error || data.user?.id !== userId) {
        const left = await recordOtpFailure(email);
        if (left === 0) throw fail('RATE_LIMITED', 'errors.otp_locked', { retry_after: 900 });
        throw fail('VALIDATION_ERROR', 'errors.validation', {
          fields: { token: 'errors.otp_invalid' },
        });
      }
      await clearOtpFailures(email);
      break;
    }
    case 'totp': {
      await rateLimit('otp_verify', `totp:${userId}`);
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp.find((f) => f.status === 'verified');
      if (!factor) throw fail('CONFLICT', 'errors.mfa_not_enrolled');
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: body.code,
      });
      if (error)
        throw fail('VALIDATION_ERROR', 'errors.validation', {
          fields: { code: 'errors.otp_invalid' },
        });
      break;
    }
    case 'password': {
      if (!email) throw fail('CONFLICT', 'errors.reauth_use_totp');
      await rateLimit('password_signin', `reauth:${userId}`);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: body.password,
      });
      if (error || data.user?.id !== userId) {
        throw fail('VALIDATION_ERROR', 'errors.validation', {
          fields: { password: 'errors.invalid_credentials' },
        });
      }
      break;
    }
  }
  await markReauthenticated(userId);
  return json({ reauthenticated: true, validForSeconds: 300 });
});
