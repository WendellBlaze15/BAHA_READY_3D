import { z } from 'zod';
import { newPasswordSchema } from '@baha/shared/auth';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { consumeReauth } from '@/lib/auth/reauth';
import { MIN_PASSWORD_SCORE, passwordScore } from '@/lib/auth/password-strength';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const schema = z.object({ password: newPasswordSchema }).strict();

/** Set or change the account password (optional sign-in method). Requires step-up. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId, claims } = await requireUser({ onboarded: true });
  await rateLimit('general', userId);
  const { password } = await parseBody(req, schema);
  if (passwordScore(password, [claims.email ?? '']) < MIN_PASSWORD_SCORE) {
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: { password: 'errors.password_weak' },
    });
  }
  await consumeReauth(userId);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw fail('VALIDATION_ERROR', 'errors.validation', {
      fields: {
        password: error.code === 'same_password' ? 'errors.password_same' : 'errors.password_weak',
      },
    });
  }
  await supabase.auth.signOut({ scope: 'others' });
  return json({ updated: true });
});
