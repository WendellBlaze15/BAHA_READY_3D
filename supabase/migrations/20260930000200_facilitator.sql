-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0011 · Facilitator features: notifications, emails, analytics RPCs
-- ════════════════════════════════════════════════════════════════════

-- Queue an email for a user (respects preferences, suppressions, undeliverable addresses).
create or replace function public.enqueue_email(p_user_id uuid, p_template text, p_params jsonb default '{}'::jsonb, p_critical boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_lang text;
  v_pref boolean;
begin
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email ~* '@(bahaready\.internal|test\.local)$' then return; end if;
  if exists (select 1 from public.email_suppressions s where s.email = v_email::extensions.citext) then return; end if;
  select p.language into v_lang from public.profiles p where p.id = p_user_id;
  select coalesce((s.notifications ->> 'email')::boolean, true) into v_pref from public.user_settings s where s.user_id = p_user_id;
  if not p_critical and v_pref is false then return; end if;
  insert into public.email_outbox (user_id, to_email, template_key, params, locale)
  values (p_user_id, v_email, p_template, coalesce(p_params, '{}'::jsonb), coalesce(v_lang, 'fil'));
end;
$$;
revoke execute on function public.enqueue_email(uuid, text, jsonb, boolean) from public, anon, authenticated;

-- ── Group membership events ────────────────────────────────────────────
create or replace function public.on_group_member_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  uname text;
begin
  select * into g from public.groups where id = new.group_id;
  select username::text into uname from public.profiles where id = new.user_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_user(g.facilitator_id, 'join_request', 'Bagong join request · New join request',
      uname || ' → ' || g.name, jsonb_build_object('href', '/facilitator/groups/' || g.id));
    perform public.enqueue_email(g.facilitator_id, 'join_request_pending',
      jsonb_build_object('group', g.name, 'username', uname, 'href', '/facilitator/groups/' || g.id));
  elsif tg_op = 'INSERT' and new.status = 'active' then
    perform public.notify_user(new.user_id, 'group_joined', 'Nakasali ka na · You joined ' || g.name, '',
      jsonb_build_object('href', '/groups/' || g.id));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    perform public.notify_user(new.user_id, 'join_approved', 'Tinanggap ka sa group · You were accepted',
      g.name, jsonb_build_object('href', '/groups/' || g.id));
    perform public.enqueue_email(new.user_id, 'join_request_approved', jsonb_build_object('group', g.name, 'href', '/groups/' || g.id));
  end if;
  return new;
end;
$$;
create trigger group_members_notify after insert or update of status on public.group_members
  for each row execute function public.on_group_member_change();

-- ── New assignment → every active member ───────────────────────────────
create or replace function public.on_assignment_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record;
  gname text;
begin
  select name into gname from public.groups where id = new.group_id;
  for m in select user_id from public.group_members where group_id = new.group_id and status = 'active' loop
    perform public.notify_user(m.user_id, 'assignment', '📋 ' || new.title, gname,
      jsonb_build_object('href', '/groups/' || new.group_id, 'assignment_id', new.id));
    perform public.enqueue_email(m.user_id, 'assignment_new',
      jsonb_build_object('title', new.title, 'group', gname, 'due_at', new.due_at, 'href', '/groups/' || new.group_id));
  end loop;
  return new;
end;
$$;
create trigger assignments_notify after insert on public.assignments
  for each row execute function public.on_assignment_created();

-- ── Group announcement → every active member ───────────────────────────
create or replace function public.on_announcement_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.scope = 'group' then
    for m in select user_id from public.group_members where group_id = new.group_id and status = 'active' loop
      perform public.notify_user(m.user_id, 'announcement', '📣 ' || new.title, left(new.body, 200),
        jsonb_build_object('href', '/groups/' || new.group_id));
      perform public.enqueue_email(m.user_id, 'group_announcement',
        jsonb_build_object('title', new.title, 'body', left(new.body, 1000), 'href', '/groups/' || new.group_id));
    end loop;
  else
    insert into public.notifications (user_id, type, title, body, data)
    select p.id, 'announcement', '📣 ' || new.title, left(new.body, 200), '{}'::jsonb
    from public.profiles p where p.status = 'active';
  end if;
  return new;
end;
$$;
create trigger announcements_notify after insert on public.announcements
  for each row execute function public.on_announcement_created();

revoke execute on function public.on_group_member_change(), public.on_assignment_created(),
  public.on_announcement_created() from public, anon, authenticated;

-- ── Assignment due-soon / overdue reminders (hourly) ───────────────────
alter table public.assignments add column if not exists reminded_due_soon boolean not null default false;
alter table public.assignments add column if not exists reminded_overdue boolean not null default false;

create or replace function public.remind_assignments()
returns void language plpgsql security definer set search_path = '' as $$
declare a record; m record;
begin
  for a in select * from public.assignments where not reminded_due_soon and due_at between now() and now() + interval '24 hours' loop
    for m in select gm.user_id from public.group_members gm where gm.group_id = a.group_id and gm.status = 'active'
      and not exists (select 1 from public.attempts t where t.user_id = gm.user_id and t.level_id = any (a.level_ids)
                      and t.status = 'completed' and t.stars >= a.min_stars and t.finished_at >= a.starts_at) loop
      perform public.notify_user(m.user_id, 'assignment_due', '⏰ ' || a.title, 'Due in 24h', jsonb_build_object('href', '/groups/' || a.group_id));
      perform public.enqueue_email(m.user_id, 'assignment_due_soon', jsonb_build_object('title', a.title, 'due_at', a.due_at, 'href', '/groups/' || a.group_id));
    end loop;
    update public.assignments set reminded_due_soon = true where id = a.id;
  end loop;
  for a in select * from public.assignments where not reminded_overdue and due_at < now() loop
    for m in select gm.user_id from public.group_members gm where gm.group_id = a.group_id and gm.status = 'active'
      and not exists (select 1 from public.attempts t where t.user_id = gm.user_id and t.level_id = any (a.level_ids)
                      and t.status = 'completed' and t.stars >= a.min_stars and t.finished_at >= a.starts_at) loop
      perform public.enqueue_email(m.user_id, 'assignment_overdue', jsonb_build_object('title', a.title, 'href', '/groups/' || a.group_id));
    end loop;
    update public.assignments set reminded_overdue = true where id = a.id;
  end loop;
end;
$$;
revoke execute on function public.remind_assignments() from public, anon, authenticated;
select cron.schedule('remind-assignments', '5 * * * *', $$select public.remind_assignments()$$);

-- ── Analytics RPCs (owner or admin only) ───────────────────────────────
create or replace function public.can_view_group(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.is_group_owner(gid) and public.authorize('attempts.view_group')) or public.authorize('users.manage');
$$;
revoke execute on function public.can_view_group(uuid) from public, anon;
grant execute on function public.can_view_group(uuid) to authenticated;

/** Facilitator overview across all their groups (or one group). */
create or replace function public.facilitator_overview(p_group_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gids uuid[];
  res jsonb;
begin
  if not public.authorize('groups.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select array_agg(id) into gids from public.groups
  where facilitator_id = uid and not is_archived and (p_group_id is null or id = p_group_id);
  gids := coalesce(gids, '{}');

  with members as (
    select distinct gm.user_id from public.group_members gm where gm.group_id = any (gids) and gm.status = 'active'
  ), att as (
    select a.* from public.attempts a join members m on m.user_id = a.user_id
    where a.status in ('completed', 'failed') and cardinality(a.flag_reasons) = 0
  ), mistakes as (
    select m.key, count(*) as n
    from att, lateral jsonb_array_elements_text(coalesce(att.summary -> 'mistakes', '[]'::jsonb)) as m(key)
    group by m.key order by n desc limit 3
  ), asg as (
    select a.id, a.level_ids, a.min_stars, a.starts_at, a.group_id from public.assignments a where a.group_id = any (gids)
  ), completion as (
    select count(*) filter (where done) as done, count(*) as total from (
      select exists (
        select 1 from att t where t.user_id = gm.user_id and t.level_id = any (asg.level_ids)
          and t.status = 'completed' and t.stars >= asg.min_stars and t.finished_at >= asg.starts_at
      ) as done
      from asg join public.group_members gm on gm.group_id = asg.group_id and gm.status = 'active'
    ) x
  )
  select jsonb_build_object(
    'groups', cardinality(gids),
    'members', (select count(*) from members),
    'active_today', (select count(distinct user_id) from att where started_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'),
    'avg_stars', (select round(avg(stars)::numeric, 2) from att where status = 'completed'),
    'attempts', (select count(*) from att),
    'completion_rate', (select case when total = 0 then null else round(done::numeric / total, 3) end from completion),
    'top_mistakes', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'count', n)), '[]'::jsonb) from mistakes),
    'pending_requests', (select count(*) from public.group_members where group_id = any (gids) and status = 'pending')
  ) into res;
  return res;
end;
$$;
revoke execute on function public.facilitator_overview(uuid) from public, anon;
grant execute on function public.facilitator_overview(uuid) to authenticated;

/** Group analytics for charts (Section 6.3). */
create or replace function public.group_analytics(p_group_id uuid, p_from timestamptz default null, p_to timestamptz default null, p_level_id smallint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.can_view_group(p_group_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with members as (
    select user_id from public.group_members where group_id = p_group_id and status = 'active'
  ), att as (
    select a.*, row_number() over (partition by a.user_id, a.level_id order by a.started_at) as n,
           count(*) over (partition by a.user_id, a.level_id) as total_n
    from public.attempts a join members m using (user_id)
    where a.status in ('completed', 'failed') and cardinality(a.flag_reasons) = 0
      and (p_from is null or a.started_at >= p_from) and (p_to is null or a.started_at <= p_to)
      and (p_level_id is null or a.level_id = p_level_id)
  )
  select jsonb_build_object(
    'score_distribution', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'count', c) order by b), '[]'::jsonb)
      from (select least(width_bucket(score, 0, 3000, 10), 11) as b, count(*) as c from att group by 1) x),
    'missed_items', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc), '[]'::jsonb)
      from (select replace(m, 'missing_', '') as k, count(*) as c
            from att, lateral jsonb_array_elements_text(coalesce(att.summary -> 'mistakes', '[]'::jsonb)) m
            where m like 'missing_%' group by 1 order by 2 desc limit 8) x),
    'hazard_hits', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc), '[]'::jsonb)
      from (select m as k, count(*) as c
            from att, lateral jsonb_array_elements_text(coalesce(att.summary -> 'mistakes', '[]'::jsonb)) m
            where m in (select key from public.hazards) group by 1) x),
    'improvement', (
      select coalesce(jsonb_agg(jsonb_build_object('attempt', n, 'avg_score', s) order by n), '[]'::jsonb)
      from (select n, round(avg(score)) as s from att where n <= 8 group by n) x),
    'pre_post', (
      select jsonb_build_object(
        'first_avg', round(avg(score) filter (where n = 1)),
        'latest_avg', round(avg(score) filter (where n = total_n and total_n > 1)),
        'first_stars', round(avg(stars) filter (where n = 1), 2),
        'latest_stars', round(avg(stars) filter (where n = total_n and total_n > 1), 2))
      from att),
    'pass_rate', (select round(avg(case when status = 'completed' then 1 else 0 end)::numeric, 3) from att),
    'attempts', (select count(*) from att)
  ) into res;
  return res;
end;
$$;
revoke execute on function public.group_analytics(uuid, timestamptz, timestamptz, smallint) from public, anon;
grant execute on function public.group_analytics(uuid, timestamptz, timestamptz, smallint) to authenticated;

/** Member-facing roster (usernames only) for a group they belong to. */
create or replace function public.get_group_roster(p_group_id uuid)
returns table (user_id uuid, username text, avatar_config jsonb, status text, joined_at timestamptz,
               levels_done int, stars int, last_played timestamptz)
language sql stable security definer set search_path = '' as $$
  select gm.user_id, p.username::text, p.avatar_config, gm.status, gm.joined_at,
         (select count(*)::int from public.player_level_progress x where x.user_id = gm.user_id and x.level_id > 0 and x.best_stars > 0),
         (select coalesce(sum(best_stars), 0)::int from public.player_level_progress x where x.user_id = gm.user_id),
         (select max(started_at) from public.attempts a where a.user_id = gm.user_id)
  from public.group_members gm join public.profiles p on p.id = gm.user_id
  where gm.group_id = p_group_id and gm.status in ('active', 'pending')
    and (public.is_group_owner(p_group_id) or public.authorize('users.manage')
         or (public.is_group_member(p_group_id) and gm.status = 'active'))
  order by gm.status desc, p.username;
$$;
revoke execute on function public.get_group_roster(uuid) from public, anon;
grant execute on function public.get_group_roster(uuid) to authenticated;

/** Assignment completion per member (for the live completion ring). */
create or replace function public.assignment_progress(p_assignment_id uuid)
returns table (user_id uuid, username text, done boolean, best_stars int)
language sql stable security definer set search_path = '' as $$
  select gm.user_id, p.username::text,
         bool_and(exists (select 1 from public.attempts t where t.user_id = gm.user_id and t.level_id = lvl
           and t.status = 'completed' and t.stars >= a.min_stars and t.finished_at >= a.starts_at and cardinality(t.flag_reasons) = 0)),
         coalesce(min((select max(t.stars) from public.attempts t where t.user_id = gm.user_id and t.level_id = lvl
           and t.status = 'completed' and t.finished_at >= a.starts_at)), 0)::int
  from public.assignments a
  join public.group_members gm on gm.group_id = a.group_id and gm.status = 'active'
  join public.profiles p on p.id = gm.user_id
  cross join lateral unnest(a.level_ids) as lvl
  where a.id = p_assignment_id
    and (public.is_group_owner(a.group_id) or public.is_group_member(a.group_id) or public.authorize('users.manage'))
  group by gm.user_id, p.username;
$$;
revoke execute on function public.assignment_progress(uuid) from public, anon;
grant execute on function public.assignment_progress(uuid) to authenticated;
