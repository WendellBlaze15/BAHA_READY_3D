/** Custom JWT claims injected by public.custom_access_token_hook. */
export type AppClaims = {
  sub: string;
  email?: string;
  aal?: 'aal1' | 'aal2';
  user_role?: 'player' | 'facilitator' | 'admin' | 'super_admin';
  permissions?: string[];
  user_status?: 'active' | 'suspended' | 'deleted';
  onboarded?: boolean;
  /**
   * Survival Mode eligibility (player role, no staff role, active, not restricted). UI hint only:
   * the middleware and the game server re-check live. Never use the bare survival.play
   * permission for this — facilitators keep the player role.
   */
  can_play_survival?: boolean;
  session_id?: string;
};

export type Permission =
  | 'levels.play_all'
  | 'leaderboard.appear'
  | 'groups.join'
  | 'facilitator.apply'
  | 'groups.manage'
  | 'assignments.manage'
  | 'attempts.view_group'
  | 'reports.export'
  | 'applications.review'
  | 'content.manage'
  | 'leaderboard.moderate'
  | 'users.manage'
  | 'audit.read'
  | 'announcements.system'
  | 'admins.manage'
  | 'system.manage'
  | 'audit.read_all'
  | 'survival.play'
  | 'survival.config.manage'
  | 'survival.reports.review'
  | 'survival.rooms.monitor'
  | 'survival.rooms.force_close'
  | 'survival.system.toggle';

export const STAFF_ROLES = ['facilitator', 'admin', 'super_admin'] as const;

export function hasPermission(claims: AppClaims | null | undefined, permission: Permission) {
  return !!claims && claims.user_status === 'active' && !!claims.permissions?.includes(permission);
}

/** Where "open the app" should take a signed-in user (mirrors post-sign-in routing). */
export function homeFor(claims: AppClaims) {
  if (!claims.onboarded) return '/onboarding';
  if (claims.user_role === 'super_admin') return '/super';
  if (claims.user_role === 'admin') return '/admin';
  if (claims.user_role === 'facilitator') return '/facilitator';
  return '/home';
}

export function isStaff(claims: AppClaims | null | undefined) {
  return !!claims?.user_role && (STAFF_ROLES as readonly string[]).includes(claims.user_role);
}

/** Decode (NOT verify) a JWT payload. Only use on tokens just issued by Supabase to this server. */
export function decodeJwtClaims(token: string): AppClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json =
      typeof atob === 'function'
        ? atob(part.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json) as AppClaims;
  } catch {
    return null;
  }
}
