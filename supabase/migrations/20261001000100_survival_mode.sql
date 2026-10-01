-- ════════════════════════════════════════════════════════════════════════
-- Survival Mode (BAHA_READY_SURVIVAL_MODE_PROMPT.md Section 19)
-- Players only. Facilitators, admins and super admins cannot play; there are NO policies that
-- give facilitators any survival data. Gameplay writes come only from the game server
-- (service role). RLS is enabled on every table.
-- ════════════════════════════════════════════════════════════════════════

-- ── Permissions (Section 2.1) ───────────────────────────────────────────
insert into public.permissions (id, name, requires_mfa) values
  (40, 'survival.play',              false),
  (41, 'survival.config.manage',     true),
  (42, 'survival.reports.review',    true),
  (43, 'survival.rooms.monitor',     true),
  (44, 'survival.rooms.force_close', true),
  (45, 'survival.system.toggle',     true)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id) values
  (2, 40),                                  -- player
  (4, 41), (4, 42), (4, 43),                -- admin
  (5, 41), (5, 42), (5, 43), (5, 44), (5, 45) -- super admin
on conflict do nothing;

-- ── Config versions ──────────────────────────────────────────────────────
create table public.survival_config_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique check (version > 0),
  config jsonb not null check (pg_column_size(config) < 1048576),
  is_current boolean not null default false,
  notes text check (char_length(notes) <= 1000),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now()
);
create unique index survival_config_one_current on public.survival_config_versions (is_current) where is_current;

-- ── Restrictions (needed by eligibility) ─────────────────────────────────
create table public.survival_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('survival', 'chat')),
  reason text not null check (char_length(reason) between 3 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,            -- null = permanent
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  lifted_notified boolean not null default false,
  check (ends_at is null or ends_at > starts_at)
);
create index survival_restrictions_user_idx on public.survival_restrictions (user_id, scope) where revoked_at is null;

-- ── Eligibility (Section 2.2) ────────────────────────────────────────────
-- Player role AND none of facilitator/admin/super_admin, active onboarded profile, and no
-- active survival restriction. (The global kill switch is checked separately so the UI can
-- show "temporarily off" instead of "not allowed".)
create or replace function public.can_play_survival(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select uid is not null
    and exists (select 1 from public.user_roles where user_id = uid and role_id = 2)
    and not exists (select 1 from public.user_roles where user_id = uid and role_id in (3, 4, 5))
    and exists (select 1 from public.profiles p where p.id = uid and p.status = 'active'
                and p.deleted_at is null and p.onboarded_at is not null and p.consent_at is not null)
    and not exists (
      select 1 from public.survival_restrictions r
      where r.user_id = uid and r.scope = 'survival' and r.revoked_at is null
        and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()));
$$;
revoke execute on function public.can_play_survival(uuid) from public, anon;
grant execute on function public.can_play_survival(uuid) to authenticated, service_role, supabase_auth_admin;

-- Facilitator / admin / super admin (staff never get survival data, even their own old rows).
create or replace function public.has_staff_role(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = uid and role_id in (3, 4, 5));
$$;
revoke execute on function public.has_staff_role(uuid) from public, anon;
grant execute on function public.has_staff_role(uuid) to authenticated, service_role;

create or replace function public.chat_restricted(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.survival_restrictions r
    where r.user_id = uid and r.scope = 'chat' and r.revoked_at is null
      and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()));
$$;
revoke execute on function public.chat_restricted(uuid) from public, anon;
grant execute on function public.chat_restricted(uuid) to authenticated, service_role;

-- Token hook: add the can_play_survival claim (UI hides/shows without an extra query; the
-- middleware and game server still re-check live).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := event -> 'claims';
  top_role text;
  perms jsonb;
  st text;
  onboarded boolean;
begin
  select r.name into top_role
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = uid
  order by r.id desc
  limit 1;

  select coalesce(jsonb_agg(distinct p.name), '[]'::jsonb) into perms
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = uid;

  select pr.status, pr.consent_at is not null and pr.onboarded_at is not null
    into st, onboarded
  from public.profiles pr where pr.id = uid;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(top_role, 'player')));
  claims := jsonb_set(claims, '{permissions}', case when st = 'active' then perms else '[]'::jsonb end);
  claims := jsonb_set(claims, '{user_status}', to_jsonb(coalesce(st, 'active')));
  claims := jsonb_set(claims, '{onboarded}', to_jsonb(coalesce(onboarded, false)));
  claims := jsonb_set(claims, '{can_play_survival}', to_jsonb(coalesce(public.can_play_survival(uid), false)));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ── Runs, members, sessions ──────────────────────────────────────────────
create table public.survival_runs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('solo', 'coop')),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  config_version_id uuid not null references public.survival_config_versions (id),
  seed bigint not null,
  status text not null default 'lobby'
    check (status in ('lobby', 'active', 'completed', 'failed', 'abandoned', 'expired', 'force_closed')),
  current_day smallint not null default 1 check (current_day between 1 and 31),
  boat_stage smallint not null default 0 check (boat_stage between 0 and 6),
  ending text check (ending in ('full_rescue', 'partial_rescue', 'failed')),
  final_score int,
  flags text[] not null default '{}',
  expiry_warned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_session_at timestamptz,
  ended_at timestamptz
);
create index survival_runs_host_idx on public.survival_runs (host_id);
create index survival_runs_status_idx on public.survival_runs (status, last_session_at);
create index survival_runs_config_idx on public.survival_runs (config_version_id);
create trigger survival_runs_updated_at before update on public.survival_runs
  for each row execute function public.set_updated_at();

create table public.survival_run_members (
  run_id uuid not null references public.survival_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'solo' check (role in ('medic', 'builder', 'scout', 'cook', 'radio', 'solo')),
  status text not null default 'active' check (status in ('active', 'left', 'kicked')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  deaths smallint not null default 0,
  revives_given smallint not null default 0,
  primary key (run_id, user_id)
);
create index survival_run_members_user_idx on public.survival_run_members (user_id, status);

create table public.survival_sessions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.survival_runs (id) on delete cascade,
  room_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (char_length(end_reason) <= 60)
);
create index survival_sessions_run_idx on public.survival_sessions (run_id, started_at desc);

create table public.survival_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.survival_runs (id) on delete cascade,
  day smallint not null,
  time_of_day smallint not null,
  -- Plain JSON, or gzip (fflate) when larger than 64 KB.
  state jsonb,
  state_gz bytea,
  byte_size int not null,
  created_at timestamptz not null default now(),
  check (state is not null or state_gz is not null)
);
create index survival_snapshots_run_idx on public.survival_snapshots (run_id, created_at desc);

-- Keep only the latest 5 snapshots per run.
create or replace function public.prune_survival_snapshots()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.survival_snapshots s
  where s.run_id = new.run_id
    and s.id not in (select id from public.survival_snapshots where run_id = new.run_id
                     order by created_at desc limit 5);
  return null;
end;
$$;
create trigger survival_snapshots_prune after insert on public.survival_snapshots
  for each row execute function public.prune_survival_snapshots();

create table public.survival_results (
  run_id uuid primary key references public.survival_runs (id) on delete cascade,
  ending text not null check (ending in ('full_rescue', 'partial_rescue', 'failed')),
  days_survived smallint not null,
  final_score int not null,
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  team_size smallint not null check (team_size between 1 and 5),
  real_minutes_played int not null,
  learning_summary jsonb not null default '{}',
  per_player jsonb not null default '{}',
  verified boolean not null default true,
  created_at timestamptz not null default now()
);
create index survival_results_board_idx on public.survival_results (difficulty, team_size, final_score desc);

create table public.survival_learning_events (
  id bigserial primary key,
  run_id uuid not null references public.survival_runs (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  day smallint not null,
  event_key text not null check (event_key ~ '^[a-z0-9_]{2,60}$'),
  is_positive boolean not null,
  created_at timestamptz not null default now()
);
create index survival_learning_run_idx on public.survival_learning_events (run_id);
create index survival_learning_user_idx on public.survival_learning_events (user_id, created_at desc);

-- ── Chat, reports, blocks, mutes, flags (Section 17) ─────────────────────
create table public.survival_chat_messages (
  id bigserial primary key,
  run_id uuid not null references public.survival_runs (id) on delete cascade,
  session_id uuid references public.survival_sessions (id) on delete set null,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body_original text not null check (char_length(body_original) <= 600),
  body_delivered text check (char_length(body_delivered) <= 600),
  status text not null check (status in ('delivered', 'masked', 'rejected', 'hidden')),
  filter_hits text[] not null default '{}',
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index survival_chat_run_idx on public.survival_chat_messages (run_id, created_at);
create index survival_chat_sender_idx on public.survival_chat_messages (sender_id, created_at);
create index survival_chat_session_idx on public.survival_chat_messages (session_id);

create table public.survival_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.survival_runs (id) on delete set null,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('chat_harassment', 'chat_language', 'personal_info_request',
                                         'griefing', 'afk', 'offensive_name_avatar', 'other')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  message_id bigint references public.survival_chat_messages (id) on delete set null,
  evidence jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'dismissed', 'warned', 'restricted', 'escalated')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_note text check (char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (reporter_id <> reported_id)
);
create index survival_reports_queue_idx on public.survival_reports (status, priority, created_at);
create index survival_reports_reporter_idx on public.survival_reports (reporter_id);
create index survival_reports_reported_idx on public.survival_reports (reported_id);
create index survival_reports_run_idx on public.survival_reports (run_id);
create index survival_reports_message_idx on public.survival_reports (message_id);

create table public.survival_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index survival_blocks_blocked_idx on public.survival_blocks (blocked_id);

create table public.survival_mutes (
  muter_id uuid not null references public.profiles (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
create index survival_mutes_muted_idx on public.survival_mutes (muted_id);

create table public.survival_chat_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  run_id uuid references public.survival_runs (id) on delete set null,
  reason text not null check (char_length(reason) <= 200),
  auto boolean not null default true,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);
create index survival_chat_flags_queue_idx on public.survival_chat_flags (status, created_at);
create index survival_chat_flags_user_idx on public.survival_chat_flags (user_id);
create index survival_chat_flags_run_idx on public.survival_chat_flags (run_id);

create table public.survival_player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  runs_completed int not null default 0,
  full_rescues int not null default 0,
  nights_survived int not null default 0,
  revives_given int not null default 0,
  boat_stages_built int not null default 0,
  updated_at timestamptz not null default now()
);
create trigger survival_player_stats_updated_at before update on public.survival_player_stats
  for each row execute function public.set_updated_at();

-- ── Reward cosmetics (Section 15.1; owned items gate Avatar Studio) ──────
create table public.cosmetic_items (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  slot text not null check (slot in ('hat', 'accessory')),
  name_fil text not null,
  name_en text not null,
  -- e.g. {"type":"survival_ending","ending":"full_rescue","difficulty":"hard"}
  unlock_rule jsonb not null,
  is_reward boolean not null default true
);
create table public.player_cosmetics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_key text not null references public.cosmetic_items (key) on delete cascade,
  source text not null default 'survival',
  unlocked_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
create index player_cosmetics_item_idx on public.player_cosmetics (item_key);

insert into public.cosmetic_items (key, slot, name_fil, name_en, unlock_rule) values
  ('vest_rescue_orange', 'accessory', 'Orange na rescue vest', 'Orange rescue vest', '{"type":"survival_ending","ending":["full_rescue","partial_rescue"]}'),
  ('cap_heli_pilot', 'hat', 'Sumbrero ng piloto', 'Helicopter pilot cap', '{"type":"survival_ending","ending":["full_rescue"],"difficulty":"normal"}'),
  ('paddle_golden', 'accessory', 'Gintong sagwan', 'Golden paddle', '{"type":"survival_ending","ending":["full_rescue"],"difficulty":"hard"}'),
  ('armband_medic', 'accessory', 'Medic armband', 'Medic armband', '{"type":"survival_total","stat":"revives_given","min":25}'),
  ('hat_builder', 'hat', 'Hard hat ng builder', 'Builder''s hard hat', '{"type":"survival_total","stat":"boat_stages_built","min":20}'),
  ('lantern', 'accessory', 'Parol na ilaw', 'Lantern', '{"type":"survival_total","stat":"nights_survived","min":100}');

-- Reward cosmetics can't be equipped unless owned (prevents unlocking via the API).
create or replace function public.guard_reward_cosmetics()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  foreach k in array array[new.avatar_config ->> 'hat', new.avatar_config ->> 'accessory'] loop
    if k is not null
       and exists (select 1 from public.cosmetic_items c where c.key = k and c.is_reward)
       and not exists (select 1 from public.player_cosmetics pc where pc.user_id = new.id and pc.item_key = k)
    then
      raise exception 'COSMETIC_LOCKED' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
create trigger profiles_guard_reward_cosmetics before update of avatar_config on public.profiles
  for each row when (old.avatar_config is distinct from new.avatar_config)
  execute function public.guard_reward_cosmetics();

-- ── Achievements (Section 15.2) ──────────────────────────────────────────
insert into public.achievements (key, name_fil, name_en, description_fil, description_en, icon_key, rule) values
  ('survival_30_days', '30 Araw', '30 Days', 'Makaligtas ng 30 araw sa Survival Mode.', 'Survive 30 days in Survival Mode.', 'calendar', '{"type":"survival_days","days":30}'),
  ('survival_walang_iwanan', 'Walang Iwanan', 'No One Left Behind', 'Buong Pagliligtas kasama ang 5 manlalaro.', 'Full Rescue with 5 players.', 'users', '{"type":"survival_ending","ending":"full_rescue","team_size":5}'),
  ('survival_mag_isang_bayani', 'Mag-isang Bayani', 'Solo Hero', 'Buong Pagliligtas nang mag-isa.', 'Full Rescue solo.', 'user', '{"type":"survival_ending","ending":"full_rescue","team_size":1}'),
  ('survival_malinis_na_tubig', 'Malinis na Tubig', 'Clean Water', 'Hindi uminom ng maduming tubig sa buong laro.', 'Never drank unsafe water in a full run.', 'droplet', '{"type":"survival_no_event","event":"drank_unsafe_water"}'),
  ('survival_bakal_na_loob', 'Bakal na Loob', 'Iron Will', 'Buong Pagliligtas sa Hard nang walang namatay.', 'Full Rescue on Hard with zero deaths.', 'shield', '{"type":"survival_ending","ending":"full_rescue","difficulty":"hard","deaths":0}'),
  ('survival_tagapagligtas', 'Tagapagligtas', 'Rescuer', 'Iligtas ang lahat ng stranded na survivor sa isang laro.', 'Rescue all stranded survivors in one run.', 'life-buoy', '{"type":"survival_all_npcs"}')
on conflict (key) do nothing;

-- ── Settings ─────────────────────────────────────────────────────────────
insert into public.system_settings (key, value, is_public) values
  ('survival_enabled', 'true', true),
  ('survival_chat_enabled', 'true', true),
  ('survival_max_active_runs_per_player', '3', true),
  ('survival_disabled_message', '{"fil":"Pansamantalang naka-off ang Survival Mode.","en":"Survival Mode is temporarily off."}', true)
on conflict (key) do nothing;

alter table public.user_settings
  add column if not exists survival_chat_mode text not null default 'full'
  check (survival_chat_mode in ('full', 'quick_only', 'off'));

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.survival_config_versions enable row level security;
alter table public.survival_restrictions enable row level security;
alter table public.survival_runs enable row level security;
alter table public.survival_run_members enable row level security;
alter table public.survival_sessions enable row level security;
alter table public.survival_snapshots enable row level security;
alter table public.survival_results enable row level security;
alter table public.survival_learning_events enable row level security;
alter table public.survival_chat_messages enable row level security;
alter table public.survival_reports enable row level security;
alter table public.survival_blocks enable row level security;
alter table public.survival_mutes enable row level security;
alter table public.survival_chat_flags enable row level security;
alter table public.survival_player_stats enable row level security;
alter table public.cosmetic_items enable row level security;
alter table public.player_cosmetics enable row level security;

-- Membership helper (eligible members only — a promoted facilitator loses read access).
create or replace function public.is_survival_member(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.survival_run_members m
                 where m.run_id = rid and m.user_id = auth.uid())
     and public.can_play_survival(auth.uid());
$$;
revoke execute on function public.is_survival_member(uuid) from public, anon;
grant execute on function public.is_survival_member(uuid) to authenticated;

create policy survival_config_read_current on public.survival_config_versions for select to authenticated
  using ((is_current and (select public.can_play_survival((select auth.uid()))))
         or (select public.authorize('survival.config.manage')));
create policy survival_config_admin_insert on public.survival_config_versions for insert to authenticated
  with check ((select public.authorize('survival.config.manage')));
create policy survival_config_admin_update on public.survival_config_versions for update to authenticated
  using ((select public.authorize('survival.config.manage')))
  with check ((select public.authorize('survival.config.manage')));

create policy survival_runs_member_read on public.survival_runs for select to authenticated
  using ((select public.is_survival_member(id)) or (select public.authorize('survival.rooms.monitor')));
create policy survival_members_read on public.survival_run_members for select to authenticated
  using ((select public.is_survival_member(run_id)) or (select public.authorize('survival.rooms.monitor')));
create policy survival_sessions_read on public.survival_sessions for select to authenticated
  using ((select public.is_survival_member(run_id)) or (select public.authorize('survival.rooms.monitor')));
create policy survival_results_read on public.survival_results for select to authenticated
  using ((select public.is_survival_member(run_id)) or (select public.authorize('survival.rooms.monitor')));
-- survival_snapshots: no policies at all (server only).
-- survival_chat_messages: no policies (players get chat from the game server; admins use
-- get_report_chat_evidence(), which is audited).

create policy survival_learning_own on public.survival_learning_events for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.can_play_survival((select auth.uid()))))
         or (select public.authorize('survival.rooms.monitor')));

create policy survival_reports_own on public.survival_reports for select to authenticated
  using ((reporter_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid())))) or (select public.authorize('survival.reports.review')));
create policy survival_reports_review on public.survival_reports for update to authenticated
  using ((select public.authorize('survival.reports.review')))
  with check ((select public.authorize('survival.reports.review')));

create policy survival_restrictions_own on public.survival_restrictions for select to authenticated
  -- No eligibility check here on purpose: a restricted player must still see why.
  using ((user_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid())))) or (select public.authorize('survival.reports.review')));
create policy survival_restrictions_admin_insert on public.survival_restrictions for insert to authenticated
  with check ((select public.authorize('survival.reports.review')) and created_by = (select auth.uid()));
create policy survival_restrictions_admin_update on public.survival_restrictions for update to authenticated
  using ((select public.authorize('survival.reports.review')))
  with check ((select public.authorize('survival.reports.review')));

create policy survival_blocks_owner on public.survival_blocks for all to authenticated
  using (blocker_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid()))))
  with check (blocker_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid()))));
create policy survival_mutes_owner on public.survival_mutes for all to authenticated
  using (muter_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid()))))
  with check (muter_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid()))));

create policy survival_chat_flags_review on public.survival_chat_flags for select to authenticated
  using ((select public.authorize('survival.reports.review')));
create policy survival_chat_flags_update on public.survival_chat_flags for update to authenticated
  using ((select public.authorize('survival.reports.review')))
  with check ((select public.authorize('survival.reports.review')));

create policy survival_player_stats_own on public.survival_player_stats for select to authenticated
  using (user_id = (select auth.uid()) and not (select public.has_staff_role((select auth.uid()))));

create policy cosmetic_items_read on public.cosmetic_items for select to anon, authenticated using (true);
create policy player_cosmetics_own on public.player_cosmetics for select to authenticated
  using (user_id = (select auth.uid()));

-- Clients never write gameplay tables directly (the game server uses the service role).
revoke insert, update, delete on public.survival_runs, public.survival_run_members, public.survival_sessions,
  public.survival_results, public.survival_learning_events, public.survival_player_stats,
  public.player_cosmetics, public.cosmetic_items from anon, authenticated;
revoke all on public.survival_snapshots, public.survival_chat_messages from anon, authenticated;
revoke all on public.survival_config_versions, public.survival_restrictions, public.survival_reports,
  public.survival_chat_flags, public.survival_blocks, public.survival_mutes from anon;
-- Reports are created by the server with server-generated evidence (Section 19.2).
revoke insert on public.survival_reports from authenticated;
-- Anonymous visitors get no access to any survival table (defence in depth on top of RLS).
revoke all on public.survival_runs, public.survival_run_members, public.survival_sessions,
  public.survival_results, public.survival_learning_events, public.survival_player_stats,
  public.player_cosmetics from anon;


-- Indexes for reviewer/creator foreign keys (advisor: unindexed_foreign_keys).
create index survival_chat_flags_reviewer_idx on public.survival_chat_flags (reviewed_by);
create index survival_chat_hidden_by_idx on public.survival_chat_messages (hidden_by);
create index survival_config_published_by_idx on public.survival_config_versions (published_by);
create index survival_reports_reviewer_idx on public.survival_reports (reviewer_id);
create index survival_restrictions_created_by_idx on public.survival_restrictions (created_by);
create index survival_restrictions_revoked_by_idx on public.survival_restrictions (revoked_by);
-- Trigger-only functions: nobody calls them directly.
revoke execute on function public.guard_reward_cosmetics(), public.prune_survival_snapshots() from public, anon, authenticated;

-- ── Audit ───────────────────────────────────────────────────────────────
create trigger audit_survival_config after insert or update on public.survival_config_versions
  for each row execute function public.audit_trigger();
create trigger audit_survival_restrictions after insert or update on public.survival_restrictions
  for each row execute function public.audit_trigger();
create trigger audit_survival_reports after update of status on public.survival_reports
  for each row when (old.status is distinct from new.status) execute function public.audit_trigger();

-- ── RPCs ────────────────────────────────────────────────────────────────
/** My active and recent runs with teammates (Survival Hub). */
create or replace function public.list_my_survival_runs()
returns table (
  run_id uuid, mode text, difficulty text, status text, current_day smallint, boat_stage smallint,
  ending text, final_score int, is_host boolean, last_session_at timestamptz, created_at timestamptz,
  teammates jsonb
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.mode, r.difficulty, r.status, r.current_day, r.boat_stage, r.ending, r.final_score,
         r.host_id = auth.uid(), r.last_session_at, r.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'username', p.username,
                     'avatar_config', p.avatar_config, 'role', m2.role, 'status', m2.status) order by m2.joined_at)
                   from public.survival_run_members m2 join public.profiles p on p.id = m2.user_id
                   where m2.run_id = r.id), '[]'::jsonb)
  from public.survival_runs r
  join public.survival_run_members m on m.run_id = r.id and m.user_id = auth.uid() and m.status = 'active'
  where public.can_play_survival(auth.uid())
    and (r.status in ('lobby', 'active') or r.ended_at > now() - interval '14 days')
  order by (r.status in ('lobby', 'active')) desc, coalesce(r.last_session_at, r.created_at) desc
  limit 20;
$$;
revoke execute on function public.list_my_survival_runs() from public, anon;
grant execute on function public.list_my_survival_runs() to authenticated;

-- Leaderboards: materialized (refreshed every minute), one row per finished, verified run.
create materialized view public.survival_leaderboard_all_time as
  select res.run_id, res.difficulty, case when res.team_size = 1 then 'solo' else 'team' end as team_type,
         res.final_score, res.real_minutes_played, res.ending, res.team_size, r.ended_at, r.host_id
  from public.survival_results res
  join public.survival_runs r on r.id = res.run_id
  where res.verified and r.status in ('completed', 'failed');
create unique index survival_lb_all_idx on public.survival_leaderboard_all_time (run_id);
create index survival_lb_all_rank_idx on public.survival_leaderboard_all_time (difficulty, team_type, final_score desc);

create materialized view public.survival_leaderboard_weekly as
  select * from public.survival_leaderboard_all_time
  where ended_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
create unique index survival_lb_week_idx on public.survival_leaderboard_weekly (run_id);
revoke all on public.survival_leaderboard_all_time, public.survival_leaderboard_weekly from anon, authenticated;

create or replace function public.refresh_survival_leaderboards()
returns void language plpgsql security definer set search_path = '' as $$
begin
  refresh materialized view concurrently public.survival_leaderboard_all_time;
  refresh materialized view concurrently public.survival_leaderboard_weekly;
end;
$$;
revoke execute on function public.refresh_survival_leaderboards() from public, anon, authenticated;

/**
 * Survival leaderboard (any signed-in role may VIEW). Members hidden by leaderboard_visible=false
 * are left out of team listings. Ranking: score desc, fewer real minutes, earlier finish.
 */
create or replace function public.get_survival_leaderboard(
  p_difficulty text, p_team_type text, p_period text default 'all_time',
  p_cursor int default 0, p_limit int default 20
)
returns table (rank bigint, run_id uuid, final_score int, ending text, team_size smallint,
               real_minutes_played int, ended_at timestamptz, members jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if p_difficulty not in ('easy', 'normal', 'hard') or p_team_type not in ('solo', 'team')
     or p_period not in ('all_time', 'weekly') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  return query
  with b as (
    select * from public.survival_leaderboard_all_time where p_period = 'all_time'
    union all
    select * from public.survival_leaderboard_weekly where p_period = 'weekly'
  ), ranked as (
    select row_number() over (order by b.final_score desc, b.real_minutes_played asc, b.ended_at asc) as rk, b.*
    from b where b.difficulty = p_difficulty and b.team_type = p_team_type
  )
  select ranked.rk, ranked.run_id, ranked.final_score, ranked.ending, ranked.team_size::smallint,
         ranked.real_minutes_played, ranked.ended_at,
         coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'avatar_config', p.avatar_config))
                   from public.survival_run_members m join public.profiles p on p.id = m.user_id
                   where m.run_id = ranked.run_id and p.leaderboard_visible and p.status = 'active'), '[]'::jsonb)
  from ranked
  where ranked.rk > p_cursor
  order by ranked.rk
  limit lim;
end;
$$;
revoke execute on function public.get_survival_leaderboard(text, text, text, int, int) from public, anon;
grant execute on function public.get_survival_leaderboard(text, text, text, int, int) to authenticated;

/**
 * Chat evidence for a report (Section 17.6): only through a report, and every view is
 * audit-logged (who viewed which report's messages, when).
 */
create or replace function public.get_report_chat_evidence(p_report_id uuid)
returns table (id bigint, sender_id uuid, sender_username text, body_original text,
               body_delivered text, status text, filter_hits text[], created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare rep record; ids bigint[];
begin
  if not public.authorize('survival.reports.review') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into rep from public.survival_reports where survival_reports.id = p_report_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(array_agg(x::bigint), '{}') into ids
  from jsonb_array_elements_text(coalesce(rep.evidence -> 'message_ids', '[]'::jsonb)) x;
  if rep.message_id is not null then ids := ids || rep.message_id; end if;

  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (auth.uid(), 'admin', 'view:survival_chat_evidence', 'survival_reports', p_report_id::text,
          jsonb_build_object('message_count', coalesce(array_length(ids, 1), 0)));

  return query
  select c.id, c.sender_id, p.username::text, c.body_original, c.body_delivered, c.status,
         c.filter_hits, c.created_at
  from public.survival_chat_messages c join public.profiles p on p.id = c.sender_id
  where c.id = any(ids)
  order by c.created_at;
end;
$$;
revoke execute on function public.get_report_chat_evidence(uuid) from public, anon;
grant execute on function public.get_report_chat_evidence(uuid) to authenticated;

-- ── Jobs (pg_cron) ──────────────────────────────────────────────────────
create or replace function public.survival_maintenance()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Warn 3 days before a paused run expires (not resumed in 30 days), then expire it.
  for r in
    select sr.id, m.user_id from public.survival_runs sr
    join public.survival_run_members m on m.run_id = sr.id and m.status = 'active'
    where sr.status in ('lobby', 'active') and not sr.expiry_warned
      and coalesce(sr.last_session_at, sr.created_at) < now() - interval '27 days'
  loop
    perform public.notify_user(r.user_id, 'survival_run_expiring', '⏳ Mag-e-expire ang inyong Survival run',
      'Ituloy ang laro sa loob ng 3 araw para hindi ito mawala.', jsonb_build_object('href', '/survival'));
  end loop;
  update public.survival_runs set expiry_warned = true
  where status in ('lobby', 'active') and not expiry_warned
    and coalesce(last_session_at, created_at) < now() - interval '27 days';
  update public.survival_runs set status = 'expired', ended_at = now()
  where status in ('lobby', 'active') and coalesce(last_session_at, created_at) < now() - interval '30 days';

  -- Restrictions that just ended → tell the player (once).
  for r in
    select id, user_id, scope from public.survival_restrictions
    where revoked_at is null and ends_at is not null and ends_at <= now() and not lifted_notified
  loop
    perform public.notify_user(r.user_id, 'survival_restriction_lifted',
      case r.scope when 'chat' then '💬 Naibalik na ang chat mo' else '🎮 Pwede ka nang maglaro ulit ng Survival Mode' end,
      '', jsonb_build_object('href', '/survival'));
    update public.survival_restrictions set lifted_notified = true where id = r.id;
  end loop;

  -- Chat retention: 14 days, except messages attached to open reports (kept up to 90 days).
  delete from public.survival_chat_messages c
  where c.created_at < now() - interval '14 days'
    and (c.created_at < now() - interval '90 days'
         or not exists (select 1 from public.survival_reports rep
                        where rep.status = 'open'
                          and (rep.message_id = c.id
                               or rep.evidence -> 'message_ids' @> to_jsonb(c.id))));
end;
$$;
revoke execute on function public.survival_maintenance() from public, anon, authenticated;

select cron.schedule('survival-maintenance', '*/15 * * * *', $$select public.survival_maintenance()$$);
select cron.schedule('survival-leaderboards', '* * * * *', $$select public.refresh_survival_leaderboards()$$);

-- ── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.survival_runs, public.survival_run_members, public.survival_results,
  public.survival_reports, public.survival_restrictions, public.survival_chat_flags,
  public.survival_config_versions, public.player_cosmetics;
