-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0006 · Leaderboards, views, notifications helper,
--                       realtime, storage, scheduled jobs
-- ════════════════════════════════════════════════════════════════════

-- ── Public profile view (safe columns only) ────────────────────────────
-- DECISION: definer-rights view on purpose — exposes ONLY username/avatar of active users,
-- to signed-in users, so rosters and leaderboards can show names without opening profiles.
create view public.public_profiles as
  select id, username, avatar_key, avatar_config
  from public.profiles
  where status = 'active';
revoke all on public.public_profiles from anon, public;
grant select on public.public_profiles to authenticated;

-- Facilitator dashboards: RLS of the underlying tables applies (security invoker).
create view public.group_progress_view with (security_invoker = true) as
  select gm.group_id, gm.user_id, gm.status as member_status, p.username, p.avatar_key,
         plp.level_id, plp.best_score, plp.best_stars, plp.attempts_count, plp.updated_at
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  left join public.player_level_progress plp on plp.user_id = gm.user_id;
grant select on public.group_progress_view to authenticated;

-- ── Leaderboards (materialized) ────────────────────────────────────────
-- level_key = level id, or -1 for the global (sum of best scores) board.
create or replace function public.leaderboard_eligible(p_since timestamptz)
returns table (user_id uuid, level_id smallint, best_score int, best_stars smallint, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.level_id, max(a.score)::int, max(a.stars)::smallint, max(a.finished_at)
  from public.attempts a
  join public.profiles p on p.id = a.user_id
  where a.status = 'completed'
    and cardinality(a.flag_reasons) = 0
    and a.mode <> 'daily'
    and a.score is not null
    and (p_since is null or a.finished_at >= p_since)
    and p.status = 'active'
    and p.leaderboard_visible
    and not exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role_id in (4, 5))
  group by a.user_id, a.level_id;
$$;
revoke execute on function public.leaderboard_eligible(timestamptz) from anon, authenticated, public;

create materialized view public.leaderboard_all_time as
  with e as (select * from public.leaderboard_eligible(null))
  select user_id, level_id::int as level_key, best_score::bigint as score, best_stars::bigint as stars, last_at from e
  union all
  select user_id, -1, sum(best_score)::bigint, sum(best_stars)::bigint, max(last_at) from e group by user_id;
create unique index leaderboard_all_time_pk on public.leaderboard_all_time (level_key, user_id);
create index leaderboard_all_time_rank_idx on public.leaderboard_all_time (level_key, score desc, last_at);

create materialized view public.leaderboard_weekly as
  with e as (
    select * from public.leaderboard_eligible(
      date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')
  )
  select user_id, level_id::int as level_key, best_score::bigint as score, best_stars::bigint as stars, last_at from e
  union all
  select user_id, -1, sum(best_score)::bigint, sum(best_stars)::bigint, max(last_at) from e group by user_id;
create unique index leaderboard_weekly_pk on public.leaderboard_weekly (level_key, user_id);
create index leaderboard_weekly_rank_idx on public.leaderboard_weekly (level_key, score desc, last_at);

-- Materialized views have no RLS: never expose them directly.
revoke all on public.leaderboard_all_time, public.leaderboard_weekly from anon, authenticated, public;

create or replace function public.refresh_leaderboards()
returns void language plpgsql security definer set search_path = '' as $$
begin
  refresh materialized view concurrently public.leaderboard_all_time;
  refresh materialized view concurrently public.leaderboard_weekly;
end;
$$;
revoke execute on function public.refresh_leaderboards() from anon, authenticated, public;

-- RPC: ranked, cursor-paginated leaderboard. Cursor = last rank seen.
create or replace function public.get_leaderboard(
  p_scope text default 'global',          -- global | level | barangay | group
  p_period text default 'all_time',       -- all_time | weekly | daily
  p_level_id smallint default null,
  p_group_id uuid default null,
  p_cursor int default 0,
  p_limit int default 20,
  p_only_me boolean default false
)
returns table (
  rank bigint, user_id uuid, username text, avatar_key text, avatar_config jsonb,
  barangay text, score bigint, stars bigint, is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  cur int := greatest(coalesce(p_cursor, 0), 0);
  lvl int := coalesce(p_level_id::int, -1);
  my_barangay text;
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_scope not in ('global', 'level', 'barangay', 'group') or p_period not in ('all_time', 'weekly', 'daily') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_scope = 'level' and p_level_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_scope in ('barangay', 'group') and uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_scope = 'group' and not (public.is_group_member(p_group_id) or public.is_group_owner(p_group_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_scope = 'barangay' then
    select p.barangay into my_barangay from public.profiles p where p.id = uid;
    if my_barangay is null then return; end if;
  end if;
  if p_only_me and uid is null then return; end if;

  return query
  with base as (
    select b.user_id, b.score, b.stars, b.last_at from public.leaderboard_all_time b
      where p_period = 'all_time' and b.level_key = lvl
    union all
    select b.user_id, b.score, b.stars, b.last_at from public.leaderboard_weekly b
      where p_period = 'weekly' and b.level_key = lvl
    union all
    select a.user_id, max(a.score)::bigint, max(a.stars)::bigint, max(a.finished_at)
      from public.attempts a join public.profiles p on p.id = a.user_id
      where p_period = 'daily' and a.mode = 'daily' and a.daily_date = today and a.status = 'completed'
        and cardinality(a.flag_reasons) = 0 and p.status = 'active' and p.leaderboard_visible
      group by a.user_id
  ),
  scoped as (
    select b.*, p.username::text as username, p.avatar_key, p.avatar_config, p.barangay
    from base b join public.profiles p on p.id = b.user_id
    where (p_scope <> 'barangay' or p.barangay = my_barangay)
      and (p_scope <> 'group' or exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = b.user_id and gm.status = 'active'))
  ),
  ranked as (
    select row_number() over (order by s.score desc, s.last_at asc, s.user_id) as rnk, s.*
    from scoped s
  )
  select r.rnk, r.user_id, r.username, r.avatar_key, r.avatar_config, r.barangay, r.score, r.stars,
         r.user_id = uid
  from ranked r
  where (p_only_me and r.user_id = uid) or (not p_only_me and r.rnk > cur)
  order by r.rnk
  limit case when p_only_me then 1 else lim end;
end;
$$;
revoke execute on function public.get_leaderboard(text, text, smallint, uuid, int, int, boolean) from public;
grant execute on function public.get_leaderboard(text, text, smallint, uuid, int, int, boolean) to anon, authenticated;

-- ── Notification helper (server-side only) ─────────────────────────────
create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text default '', p_data jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare nid uuid;
begin
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, p_type, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb))
  returning id into nid;
  return nid;
end;
$$;
revoke execute on function public.notify_user(uuid, text, text, text, jsonb) from anon, authenticated, public;

-- ── Realtime ───────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.notifications, public.player_level_progress, public.group_members, public.assignments,
  public.attempts, public.facilitator_applications, public.announcements, public.system_settings,
  public.live_sessions, public.user_settings, public.profiles, public.player_tips,
  public.player_achievements, public.report_jobs,
  public.tips, public.gobag_items, public.home_tasks, public.hazards, public.npc_types,
  public.hotlines, public.levels;

-- Topic helpers for Realtime Authorization (private channels).
create or replace function public.realtime_topic_id(prefix text)
returns uuid language plpgsql stable set search_path = '' as $$
declare t text := realtime.topic();
begin
  if t is null or t not like prefix || ':%' then return null; end if;
  return substr(t, length(prefix) + 2)::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.can_access_live_session(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_sessions ls
    where ls.id = sid and (public.is_group_owner(ls.group_id) or public.is_group_member(ls.group_id))
  );
$$;
revoke execute on function public.can_access_live_session(uuid) from anon, public;
grant execute on function public.can_access_live_session(uuid) to authenticated;

create policy realtime_receive on realtime.messages for select to authenticated using (
  realtime.topic() = 'user:' || (select auth.uid())::text
  or realtime.topic() = 'system'
  or realtime.topic() like 'leaderboard:%'
  or (realtime.topic() like 'group:%' and (
        public.is_group_member(public.realtime_topic_id('group'))
        or public.is_group_owner(public.realtime_topic_id('group'))))
  or (realtime.topic() like 'live:%' and public.can_access_live_session(public.realtime_topic_id('live')))
);

-- Sending (broadcast/presence): live session participants, and group owners on group channels.
create policy realtime_send on realtime.messages for insert to authenticated with check (
  (realtime.topic() like 'live:%' and public.can_access_live_session(public.realtime_topic_id('live')))
  or (realtime.topic() like 'group:%' and public.is_group_owner(public.realtime_topic_id('group')))
);

-- ── Storage ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']),
  ('applications', 'applications', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg']),
  ('reports', 'reports', false, 52428800, array['text/csv', 'application/pdf', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Files live under "<user_id>/<random-name>".
create policy avatars_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy applications_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'applications' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy applications_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'applications' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy applications_reviewer_read on storage.objects for select to authenticated
  using (bucket_id = 'applications' and (select public.authorize('applications.review')));

create policy reports_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Scheduled jobs ─────────────────────────────────────────────────────
create or replace function public.generate_daily_challenge(p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_date, (now() at time zone 'Asia/Manila')::date);
  pool int[];
  lvl int;
begin
  select coalesce(array(select jsonb_array_elements_text(value -> 'levels')::int), array[1, 2, 3, 4, 5])
    into pool from public.system_settings where key = 'daily_challenge';
  pool := coalesce(pool, array[1, 2, 3, 4, 5]);
  lvl := pool[1 + floor(random() * cardinality(pool))::int];
  insert into public.daily_challenges (date, seed, level_id, modifiers)
  values (
    d,
    ('x' || encode(extensions.gen_random_bytes(6), 'hex'))::bit(48)::bigint,
    lvl,
    jsonb_build_object(
      'rainBoost', round((random() * 0.3)::numeric, 2),
      'waterRiseBoost', round((random() * 0.2)::numeric, 2),
      'night', random() < 0.25
    )
  )
  on conflict (date) do nothing;
end;
$$;
revoke execute on function public.generate_daily_challenge(date) from anon, authenticated, public;

create or replace function public.abandon_stale_attempts()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.attempts set status = 'abandoned', finished_at = now()
  where status = 'in_progress' and started_at < now() - interval '2 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.abandon_stale_attempts() from anon, authenticated, public;

create or replace function public.purge_deleted_accounts()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from auth.users u using public.profiles p
  where p.id = u.id and p.status = 'deleted' and p.deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.purge_deleted_accounts() from anon, authenticated, public;

select cron.schedule('refresh-leaderboards', '* * * * *', $$select public.refresh_leaderboards()$$);
-- 16:00 UTC = 00:00 Asia/Manila
select cron.schedule('daily-challenge', '0 16 * * *', $$select public.generate_daily_challenge()$$);
select cron.schedule('abandon-stale-attempts', '*/10 * * * *', $$select public.abandon_stale_attempts()$$);
select cron.schedule('purge-deleted-accounts', '30 17 * * *', $$select public.purge_deleted_accounts()$$);
