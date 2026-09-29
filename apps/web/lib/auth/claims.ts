/** Custom JWT claims injected by public.custom_access_token_hook. */
export type AppClaims = {
  sub: string;
  email?: string;
  aal?: 'aal1' | 'aal2';
  user_role?: 'player' | 'facilitator' | 'admin' | 'super_admin';
  permissions?: string[];
  user_status?: 'active' | 'suspended' | 'deleted';
  onboarded?: boolean;
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
  | 'audit.read_all';

export const STAFF_ROLES = ['facilitator', 'admin', 'super_admin'] as const;

export function hasPermission(claims: AppClaims | null | undefined, permission: Permission) {
  return !!claims && claims.user_status === 'active' && !!claims.permissions?.includes(permission);
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
