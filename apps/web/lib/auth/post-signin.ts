import 'server-only';
import type { Session } from '@supabase/supabase-js';
import { decodeJwtClaims } from './claims';

/** Where to send the user right after a successful sign-in. */
export function nextStepAfterSignIn(session: Session, requested?: string | null) {
  const claims = decodeJwtClaims(session.access_token);
  const hasVerifiedTotp = (session.user.factors ?? []).some(
    (f) => f.factor_type === 'totp' && f.status === 'verified',
  );
  const safeNext =
    requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : null;

  if (hasVerifiedTotp && claims?.aal !== 'aal2') {
    return { next: `/mfa${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`, mfa: true };
  }
  if (!claims?.onboarded)
    return {
      next: `/onboarding${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`,
      mfa: false,
    };
  const staffHome =
    claims.user_role === 'super_admin' ? '/super' : claims.user_role === 'admin' ? '/admin' : null;
  return { next: safeNext ?? staffHome ?? '/home', mfa: false };
}
