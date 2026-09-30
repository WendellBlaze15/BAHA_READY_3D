import 'server-only';
import { getSupabaseServer } from '@/lib/supabase/server';
import { fail } from '@/lib/api/http';
import { hasPermission, type AppClaims, type Permission } from './claims';

/** Verified claims for the current request, or null. */
export async function getClaims(): Promise<AppClaims | null> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims ?? null) as AppClaims | null;
}

/** For route handlers: throws UNAUTHENTICATED / FORBIDDEN. */
export async function requireUser(opts: { permission?: Permission; onboarded?: boolean } = {}) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as AppClaims | null;
  if (!claims?.sub) throw fail('UNAUTHENTICATED', 'errors.unauthenticated');
  // Live status, not the (up to 1h old) JWT claim: suspensions apply to APIs immediately.
  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', claims.sub)
    .maybeSingle();
  const status = (profile?.status as string | undefined) ?? claims.user_status;
  if (status && status !== 'active') throw fail('FORBIDDEN', 'errors.suspended');
  if (opts.onboarded && !claims.onboarded) throw fail('FORBIDDEN', 'errors.onboarding_required');
  if (opts.permission && !hasPermission(claims, opts.permission))
    throw fail('FORBIDDEN', 'errors.forbidden');
  return { supabase, claims, userId: claims.sub };
}
