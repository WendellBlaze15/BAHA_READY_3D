import 'server-only';
import { getSupabaseServer } from '@/lib/supabase/server';
import type { AppClaims } from '@/lib/auth/claims';
import { ShellClient } from './shell-client';

/**
 * Server part of the signed-in shell: fetches the critical data once (profile, settings,
 * group ids for realtime) so first paint has content, then hands off to the client shell.
 */
export async function AuthedShell({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as AppClaims | null;
  if (!claims) return <>{children}</>; // middleware already redirects guests

  const uid = claims.sub;
  const [{ data: profile }, { data: settings }, { data: memberships }, { data: owned }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('group_members').select('group_id').eq('user_id', uid).eq('status', 'active'),
      supabase.from('groups').select('id').eq('facilitator_id', uid).eq('is_archived', false),
    ]);
  const groupIds = [
    ...new Set([...(memberships ?? []).map((m) => m.group_id), ...(owned ?? []).map((g) => g.id)]),
  ];

  return (
    <ShellClient
      claims={{
        sub: claims.sub,
        email: claims.email,
        aal: claims.aal,
        user_role: claims.user_role,
        permissions: claims.permissions,
        user_status: claims.user_status,
        onboarded: claims.onboarded,
        can_play_survival: claims.can_play_survival,
      }}
      profile={profile}
      settings={settings}
      groupIds={groupIds}
    >
      {children}
    </ShellClient>
  );
}
