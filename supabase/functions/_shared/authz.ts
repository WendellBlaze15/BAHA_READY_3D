import { HttpError } from './http.ts';

/**
 * Staff authorization for Edge Functions: permission from the verified JWT + aal2 (unless
 * the super admin disabled require_staff_mfa). The database's authorize() re-checks live
 * roles for anything done through the user's own client.
 */
export async function requireStaff(
  claims: Record<string, unknown>,
  permission: string,
  admin: { from: (t: string) => any },
) {
  const perms = (claims.permissions as string[] | undefined) ?? [];
  if (!perms.includes(permission)) throw new HttpError('FORBIDDEN', 'errors.forbidden');
  const { data } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'require_staff_mfa')
    .maybeSingle();
  const requireMfa = data?.value !== false;
  if (requireMfa && claims.aal !== 'aal2') throw new HttpError('FORBIDDEN', 'errors.mfa_required');
}

/** Write an audit row attributed to the acting staff member (service-role writes bypass triggers' auth.uid()). */
export async function audit(
  admin: { from: (t: string) => any },
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
  req: Request,
) {
  const { data: roles } = await admin.from('user_roles').select('role_id').eq('user_id', actorId);
  const top = Math.max(0, ...((roles ?? []) as { role_id: number }[]).map((r) => r.role_id));
  const roleName =
    ({ 5: 'super_admin', 4: 'admin', 3: 'facilitator', 2: 'player' } as Record<number, string>)[
      top
    ] ?? 'player';
  await admin.from('audit_logs').insert({
    actor_id: actorId,
    actor_role: roleName,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
    ip: (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  });
}
