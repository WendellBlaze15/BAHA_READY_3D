-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0013 · Staff actions as RPCs (auth.uid() = the acting staff member,
-- so the audit triggers attribute every change correctly).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.moderate_attempt(p_attempt_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.attempts;
begin
  if not public.authorize('leaderboard.moderate') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_action not in ('void', 'restore') or coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  select * into a from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_action = 'void' then
    update public.attempts set status = 'voided', void_reason = p_reason, voided_by = auth.uid() where id = p_attempt_id;
  else
    -- Restoring clears flags so the run counts again (reviewer judged it legitimate).
    update public.attempts set status = case when a.score is not null and a.stars > 0 then 'completed' else 'failed' end,
      flag_reasons = '{}', void_reason = p_reason, voided_by = auth.uid() where id = p_attempt_id;
  end if;
  perform public.recompute_progress(a.user_id, a.level_id);
  perform public.notify_user(a.user_id, 'moderation', case when p_action = 'void' then 'Na-void ang isang score · A score was voided' else 'Naibalik ang score · Score restored' end,
    p_reason, jsonb_build_object('href', '/profile'));
end;
$$;
revoke execute on function public.moderate_attempt(uuid, text, text) from public, anon;
grant execute on function public.moderate_attempt(uuid, text, text) to authenticated;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text default null, p_until timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.authorize('users.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  if p_user_id = auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  -- Admins cannot act on super admins; only super admins can act on admins.
  if exists (select 1 from public.user_roles where user_id = p_user_id and role_id = 5)
     or (exists (select 1 from public.user_roles where user_id = p_user_id and role_id = 4) and not public.has_role('super_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_status = 'suspended' and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  update public.profiles set status = p_status,
    suspension_reason = case when p_status = 'suspended' then p_reason else null end,
    suspended_until = case when p_status = 'suspended' then p_until else null end
  where id = p_user_id;
end;
$$;
revoke execute on function public.admin_set_user_status(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_set_user_status(uuid, text, text, timestamptz) to authenticated;

-- Session revocation + MFA reset touch the auth schema: service role only, called by the
-- server after it has verified the staff member (and logged the action).
create or replace function public.admin_revoke_sessions(p_user_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;

create or replace function public.admin_reset_mfa(p_user_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics n = row_count;
  delete from auth.sessions where user_id = p_user_id;
  return n;
end;
$$;
revoke execute on function public.admin_reset_mfa(uuid) from public, anon, authenticated;

create or replace function public.super_set_admin(p_user_id uuid, p_make_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.authorize('admins.manage') and public.has_role('super_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_make_admin then
    insert into public.user_roles (user_id, role_id, granted_by) values (p_user_id, 4, auth.uid()) on conflict do nothing;
    update public.profiles set leaderboard_visible = false where id = p_user_id;
  else
    delete from public.user_roles where user_id = p_user_id and role_id = 4;
    insert into public.user_roles (user_id, role_id, granted_by) values (p_user_id, 2, auth.uid()) on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.super_set_admin(uuid, boolean) from public, anon;
grant execute on function public.super_set_admin(uuid, boolean) to authenticated;

-- Publishing a new level version (append-only; players mid-attempt keep their pinned version).
create or replace function public.publish_level_version(p_level_id smallint, p_config jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v int; vid uuid;
begin
  if not public.authorize('content.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v from public.level_versions where level_id = p_level_id;
  insert into public.level_versions (level_id, version, config, notes, published_by)
  values (p_level_id, v, p_config, p_notes, auth.uid()) returning id into vid;
  update public.levels set current_version_id = vid where id = p_level_id;
  return vid;
end;
$$;
revoke execute on function public.publish_level_version(smallint, jsonb, text) from public, anon;
grant execute on function public.publish_level_version(smallint, jsonb, text) to authenticated;
