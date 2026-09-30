import 'server-only';
import { fail } from '@/lib/api/http';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { Permission } from './claims';
import { requireUser } from './session';

let mfaCache: { at: number; required: boolean } | null = null;
async function staffMfaRequired() {
  if (mfaCache && Date.now() - mfaCache.at < 60_000) return mfaCache.required;
  const { data } = await getSupabaseAdmin()
    .from('system_settings')
    .select('value')
    .eq('key', 'require_staff_mfa')
    .maybeSingle();
  mfaCache = { at: Date.now(), required: data?.value !== false };
  return mfaCache.required;
}

/** Staff route guard: permission from the verified JWT + aal2 when staff MFA is required. */
export async function requireStaff(permission: Permission) {
  const ctx = await requireUser({ permission });
  if ((await staffMfaRequired()) && ctx.claims.aal !== 'aal2')
    throw fail('FORBIDDEN', 'errors.mfa_required');
  return ctx;
}
