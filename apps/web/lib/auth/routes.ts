import { hasPermission, type AppClaims, type Permission } from './claims';

/** Route access rules, matched against the pathname WITHOUT the locale prefix. */
export type RouteRule =
  | { kind: 'public' }
  | { kind: 'guest-only' }
  | { kind: 'auth' }
  | { kind: 'player' }
  | { kind: 'staff'; permission?: Permission; role?: 'super_admin' };

const PLAYER_PREFIXES = [
  '/home',
  '/levels',
  '/results',
  '/leaderboard',
  '/groups',
  '/profile',
  '/settings',
  '/notifications',
  '/live',
  '/achievements',
  '/avatar',
  '/apply',
  '/daily',
];
// Guests may play the tutorial and Signal No. 1 with a local save.
const GUEST_PLAYABLE = ['/play/tutorial', '/play/signal-1'];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function ruleFor(path: string): RouteRule {
  if (['/sign-in', '/sign-up', '/forgot-password'].some((p) => matches(path, p)))
    return { kind: 'guest-only' };
  if (['/onboarding', '/mfa', '/suspended', '/reauth'].some((p) => matches(path, p)))
    return { kind: 'auth' };
  if (matches(path, '/super'))
    return { kind: 'staff', role: 'super_admin', permission: 'system.manage' };
  if (matches(path, '/admin')) return { kind: 'staff', permission: 'content.manage' };
  if (matches(path, '/facilitator')) return { kind: 'staff', permission: 'groups.manage' };
  if (GUEST_PLAYABLE.some((p) => matches(path, p))) return { kind: 'public' };
  if (matches(path, '/play') || PLAYER_PREFIXES.some((p) => matches(path, p)))
    return { kind: 'player' };
  return { kind: 'public' };
}

export type GuardDecision =
  { action: 'allow' } | { action: 'redirect'; to: string; reason: string };

/** Pure routing decision (unit-tested). */
export function decide(
  path: string,
  claims: AppClaims | null,
  opts: { requireStaffMfa: boolean; maintenance: boolean },
): GuardDecision {
  const rule = ruleFor(path);
  const next = encodeURIComponent(path);

  if (opts.maintenance && path !== '/maintenance' && !['guest-only', 'auth'].includes(rule.kind)) {
    const staff = claims?.user_role === 'admin' || claims?.user_role === 'super_admin';
    if (!staff) return { action: 'redirect', to: '/maintenance', reason: 'maintenance' };
  }

  if (rule.kind === 'public') return { action: 'allow' };

  if (rule.kind === 'guest-only') {
    return claims
      ? { action: 'redirect', to: '/home', reason: 'already-signed-in' }
      : { action: 'allow' };
  }

  if (!claims)
    return { action: 'redirect', to: `/sign-in?next=${next}`, reason: 'unauthenticated' };

  if (claims.user_status && claims.user_status !== 'active' && path !== '/suspended') {
    return { action: 'redirect', to: '/suspended', reason: 'suspended' };
  }
  // One-time screens: once done, send the user on instead of letting them redo them.
  if (matches(path, '/onboarding') && claims.onboarded)
    return { action: 'redirect', to: '/home', reason: 'already-onboarded' };
  if (matches(path, '/suspended') && (!claims.user_status || claims.user_status === 'active'))
    return { action: 'redirect', to: '/home', reason: 'not-suspended' };
  if (rule.kind === 'auth') return { action: 'allow' };

  if (!claims.onboarded)
    return { action: 'redirect', to: `/onboarding?next=${next}`, reason: 'onboarding' };

  if (rule.kind === 'player') return { action: 'allow' };

  // Staff routes
  if (rule.role && claims.user_role !== rule.role) {
    return { action: 'redirect', to: '/home?denied=1', reason: 'forbidden' };
  }
  if (rule.permission && !hasPermission(claims, rule.permission)) {
    return { action: 'redirect', to: '/home?denied=1', reason: 'forbidden' };
  }
  if (opts.requireStaffMfa && claims.aal !== 'aal2') {
    return { action: 'redirect', to: `/mfa?next=${next}`, reason: 'mfa' };
  }
  return { action: 'allow' };
}
