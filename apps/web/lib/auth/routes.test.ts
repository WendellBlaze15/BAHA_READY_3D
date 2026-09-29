import { describe, expect, it } from 'vitest';
import { decide, ruleFor } from './routes';
import type { AppClaims } from './claims';

const opts = { requireStaffMfa: true, maintenance: false };
const player: AppClaims = {
  sub: 'u1',
  aal: 'aal1',
  user_role: 'player',
  user_status: 'active',
  onboarded: true,
  permissions: ['levels.play_all', 'groups.join'],
};
const facilitator: AppClaims = {
  ...player,
  user_role: 'facilitator',
  permissions: ['levels.play_all', 'groups.manage'],
};
const admin: AppClaims = {
  ...player,
  user_role: 'admin',
  permissions: ['content.manage', 'users.manage'],
};
const superAdmin: AppClaims = {
  ...player,
  user_role: 'super_admin',
  permissions: ['content.manage', 'system.manage'],
};

describe('route rules', () => {
  it('classifies routes', () => {
    expect(ruleFor('/').kind).toBe('public');
    expect(ruleFor('/tips').kind).toBe('public');
    expect(ruleFor('/play/tutorial').kind).toBe('public');
    expect(ruleFor('/play/signal-3').kind).toBe('player');
    expect(ruleFor('/home').kind).toBe('player');
    expect(ruleFor('/sign-in').kind).toBe('guest-only');
    expect(ruleFor('/admin/users').kind).toBe('staff');
    expect(ruleFor('/homework').kind).toBe('public'); // prefix match must respect segments
  });
});

describe('guard decisions', () => {
  it('sends guests to sign-in with next', () => {
    expect(decide('/home', null, opts)).toEqual({
      action: 'redirect',
      to: '/sign-in?next=%2Fhome',
      reason: 'unauthenticated',
    });
  });
  it('lets guests play the tutorial', () => {
    expect(decide('/play/tutorial', null, opts).action).toBe('allow');
  });
  it('requires onboarding before play', () => {
    expect(decide('/home', { ...player, onboarded: false }, opts)).toMatchObject({
      to: '/onboarding?next=%2Fhome',
    });
  });
  it('blocks suspended users', () => {
    expect(decide('/home', { ...player, user_status: 'suspended' }, opts)).toMatchObject({
      to: '/suspended',
    });
  });
  it('keeps signed-in users away from sign-in', () => {
    expect(decide('/sign-in', player, opts)).toMatchObject({ to: '/home' });
  });
  it('denies players on staff routes', () => {
    expect(decide('/facilitator', player, opts)).toMatchObject({ reason: 'forbidden' });
    expect(decide('/admin', player, opts)).toMatchObject({ reason: 'forbidden' });
  });
  it('requires aal2 for staff when MFA is required', () => {
    expect(decide('/facilitator', facilitator, opts)).toMatchObject({ reason: 'mfa' });
    expect(decide('/facilitator', { ...facilitator, aal: 'aal2' }, opts).action).toBe('allow');
    expect(decide('/facilitator', facilitator, { ...opts, requireStaffMfa: false }).action).toBe(
      'allow',
    );
  });
  it('restricts /super to super admins', () => {
    expect(decide('/super', { ...admin, aal: 'aal2' }, opts)).toMatchObject({
      reason: 'forbidden',
    });
    expect(decide('/super', { ...superAdmin, aal: 'aal2' }, opts).action).toBe('allow');
  });
  it('shows maintenance to non-staff, not to admins', () => {
    const m = { ...opts, maintenance: true };
    expect(decide('/home', player, m)).toMatchObject({ to: '/maintenance' });
    expect(decide('/', null, m)).toMatchObject({ to: '/maintenance' });
    expect(decide('/sign-in', null, m).action).toBe('allow');
    expect(decide('/home', admin, m).action).toBe('allow');
  });
});
