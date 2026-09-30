-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0012 · Admin & super admin: KPIs, user search, moderation, broadcasts
-- ════════════════════════════════════════════════════════════════════

-- Content edits reach every open client instantly (TanStack invalidation on `system`).
create or replace function public.broadcast_content_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('table', tg_table_name), 'content_updated', 'system', false);
  return null;
end;
$$;
revoke execute on function public.broadcast_content_updated() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tips', 'hotlines', 'gobag_items', 'home_tasks', 'hazards', 'npc_types', 'levels', 'achievements']
  loop
    execute format('create trigger %1$s_broadcast after insert or update or delete on public.%1$I
                    for each statement execute function public.broadcast_content_updated()', t);
  end loop;
end $$;

-- Maintenance on/off → all clients (non-admins get the maintenance screen).
create or replace function public.broadcast_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.key = 'maintenance' then
    perform realtime.send(new.value, case when (new.value ->> 'enabled')::boolean then 'maintenance_on' else 'maintenance_off' end, 'system', false);
  end if;
  return new;
end;
$$;
revoke execute on function public.broadcast_settings() from public, anon, authenticated;
create trigger system_settings_broadcast after update on public.system_settings
  for each row execute function public.broadcast_settings();

-- ── KPIs ──────────────────────────────────────────────────────────────
create or replace function public.admin_kpis()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.authorize('users.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select jsonb_build_object(
    'dau', (select count(distinct user_id) from public.attempts where started_at > now() - interval '1 day'),
    'wau', (select count(distinct user_id) from public.attempts where started_at > now() - interval '7 days'),
    'users', (select count(*) from public.profiles where status <> 'deleted'),
    'signups_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'attempts', (select count(*) from public.attempts where status <> 'in_progress'),
    'attempts_7d', (select count(*) from public.attempts where started_at > now() - interval '7 days'),
    'flagged', (select count(*) from public.attempts where cardinality(flag_reasons) > 0 and status <> 'voided'),
    'pending_applications', (select count(*) from public.facilitator_applications where status = 'pending'),
    'email_failed', (select count(*) from public.email_outbox where status = 'failed'),
    'email_queued', (select count(*) from public.email_outbox where status = 'queued'),
    'pass_rate', (
      select coalesce(jsonb_agg(jsonb_build_object('level_id', level_id, 'rate', rate, 'n', n) order by level_id), '[]'::jsonb)
      from (select level_id, round(avg(case when status = 'completed' then 1 else 0 end)::numeric, 3) as rate, count(*) as n
            from public.attempts where status in ('completed', 'failed') group by level_id) x),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'attempts', n, 'players', p) order by d), '[]'::jsonb)
      from (select (started_at at time zone 'Asia/Manila')::date as d, count(*) as n, count(distinct user_id) as p
            from public.attempts where started_at > now() - interval '14 days' group by 1) x)
  ) into res;
  return res;
end;
$$;
revoke execute on function public.admin_kpis() from public, anon;
grant execute on function public.admin_kpis() to authenticated;

-- ── User search (admins): profile + email + roles ─────────────────────
create or replace function public.admin_search_users(p_query text default '', p_status text default null, p_offset int default 0, p_limit int default 20)
returns table (id uuid, username text, email text, status text, roles text[], created_at timestamptz, suspended_until timestamptz,
               suspension_reason text, attempts bigint, mfa boolean, total bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.authorize('users.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  with base as (
    select p.id, p.username::text as username, u.email::text as email, p.status, p.created_at, p.suspended_until, p.suspension_reason,
           array(select r.name from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id order by r.id desc) as roles,
           (select count(*) from public.attempts a where a.user_id = p.id) as attempts,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as mfa
    from public.profiles p join auth.users u on u.id = p.id
    where (coalesce(p_query, '') = '' or p.username::text ilike '%' || p_query || '%' or u.email ilike '%' || p_query || '%')
      and (p_status is null or p.status = p_status)
  )
  select b.id, b.username, b.email, b.status, b.roles, b.created_at, b.suspended_until, b.suspension_reason, b.attempts, b.mfa,
         count(*) over () as total
  from base b
  order by b.created_at desc
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 50);
end;
$$;
revoke execute on function public.admin_search_users(text, text, int, int) from public, anon;
grant execute on function public.admin_search_users(text, text, int, int) to authenticated;

-- ── Security center (super admin) ──────────────────────────────────────
create or replace function public.security_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.authorize('system.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'active_sessions', (select count(*) from auth.sessions where coalesce(not_after, now() + interval '1 day') > now() and updated_at > now() - interval '1 day'),
    'sessions_by_aal', (select coalesce(jsonb_object_agg(coalesce(aal::text, 'aal1'), n), '{}'::jsonb) from (select aal, count(*) as n from auth.sessions where updated_at > now() - interval '1 day' group by aal) x),
    'mfa_enrolled_staff', (select count(distinct ur.user_id) from public.user_roles ur join auth.mfa_factors f on f.user_id = ur.user_id and f.status = 'verified' where ur.role_id >= 3),
    'staff_total', (select count(distinct user_id) from public.user_roles where role_id >= 3),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'recent_role_changes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select action, actor_role, target_id, created_at from public.audit_logs where target_type = 'user_roles' or action like 'role.%' order by created_at desc limit 10) x),
    'recent_suspensions', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select action, target_id, metadata, created_at from public.audit_logs where action like 'user.%' order by created_at desc limit 10) x),
    'flagged_7d', (select count(*) from public.attempts where cardinality(flag_reasons) > 0 and started_at > now() - interval '7 days'),
    'flag_reasons', (select coalesce(jsonb_object_agg(r, n), '{}'::jsonb) from (select unnest(flag_reasons) as r, count(*) as n from public.attempts where started_at > now() - interval '30 days' group by 1) x)
  );
end;
$$;
revoke execute on function public.security_overview() from public, anon;
grant execute on function public.security_overview() to authenticated;

-- Moderators may read flagged-attempt usernames (profiles RLS hides them otherwise).
create or replace function public.flagged_attempts(p_include_voided boolean default false)
returns table (id uuid, user_id uuid, username text, level_id smallint, score int, stars smallint, status text,
               flag_reasons text[], started_at timestamptz, finished_at timestamptz, void_reason text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.user_id, p.username::text, a.level_id, a.score, a.stars, a.status, a.flag_reasons, a.started_at, a.finished_at, a.void_reason
  from public.attempts a join public.profiles p on p.id = a.user_id
  where public.authorize('leaderboard.moderate')
    and (cardinality(a.flag_reasons) > 0 or a.status = 'voided')
    and (p_include_voided or a.status <> 'voided')
  order by a.started_at desc
  limit 200;
$$;
revoke execute on function public.flagged_attempts(boolean) from public, anon;
grant execute on function public.flagged_attempts(boolean) to authenticated;

-- Recompute a player's best score/stars for a level after a void/restore.
create or replace function public.recompute_progress(p_user_id uuid, p_level_id smallint)
returns void language sql security definer set search_path = '' as $$
  update public.player_level_progress p set
    best_score = coalesce((select max(score) from public.attempts a where a.user_id = p_user_id and a.level_id = p_level_id
                           and a.status = 'completed' and cardinality(a.flag_reasons) = 0), 0),
    best_stars = coalesce((select max(stars) from public.attempts a where a.user_id = p_user_id and a.level_id = p_level_id
                           and a.status = 'completed' and cardinality(a.flag_reasons) = 0), 0)
  where p.user_id = p_user_id and p.level_id = p_level_id;
$$;
revoke execute on function public.recompute_progress(uuid, smallint) from public, anon, authenticated;
