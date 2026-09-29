-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0004 · Gameplay: attempts, progress, achievements, streaks
-- All writes happen in Edge Functions (service role). Clients only read.
-- ════════════════════════════════════════════════════════════════════

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  level_id smallint not null references public.levels (id),
  level_version_id uuid not null references public.level_versions (id),
  mode text not null default 'normal' check (mode in ('normal', 'daily', 'live', 'assignment')),
  seed bigint not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed', 'abandoned', 'voided')),
  score int,
  stars smallint check (stars between 0 and 3),
  duration_ms int check (duration_ms >= 0),
  npcs_rescued smallint,
  hazard_hits smallint,
  summary jsonb check (summary is null or pg_column_size(summary) < 16384),
  flag_reasons text[] not null default '{}',
  idempotency_key uuid unique,
  device_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  assignment_id uuid references public.assignments (id) on delete set null,
  live_session_id uuid references public.live_sessions (id) on delete set null,
  daily_date date,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text
);
create index attempts_user_idx on public.attempts (user_id, started_at desc);
create index attempts_level_idx on public.attempts (level_id, status);
create index attempts_level_version_idx on public.attempts (level_version_id);
create index attempts_assignment_idx on public.attempts (assignment_id);
create index attempts_live_session_idx on public.attempts (live_session_id);
create index attempts_voided_by_idx on public.attempts (voided_by);
create index attempts_flagged_idx on public.attempts (started_at desc) where cardinality(flag_reasons) > 0;
create index attempts_leaderboard_idx on public.attempts (level_id, finished_at)
  where status = 'completed';
create index attempts_daily_idx on public.attempts (daily_date, score desc) where mode = 'daily';
-- A player can only run one attempt at a time (starting a new one abandons the old).
create unique index attempts_one_in_progress_idx on public.attempts (user_id) where status = 'in_progress';

create table public.attempt_events (
  attempt_id uuid primary key references public.attempts (id) on delete cascade,
  events jsonb not null check (jsonb_typeof(events) = 'array'),
  byte_size int not null check (byte_size between 0 and 262144),
  created_at timestamptz not null default now()
);

create table public.player_level_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  level_id smallint not null references public.levels (id),
  best_score int not null default 0,
  best_stars smallint not null default 0 check (best_stars between 0 and 3),
  attempts_count int not null default 0,
  unlocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, level_id)
);
create index player_level_progress_level_idx on public.player_level_progress (level_id);
create trigger player_level_progress_updated_at before update on public.player_level_progress
  for each row execute function public.set_updated_at();

create table public.player_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create index player_achievements_achievement_idx on public.player_achievements (achievement_id);

create table public.player_tips (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tip_id uuid not null references public.tips (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (user_id, tip_id)
);
create index player_tips_tip_idx on public.player_tips (tip_id);

create table public.daily_challenges (
  date date primary key,
  seed bigint not null,
  level_id smallint not null references public.levels (id),
  modifiers jsonb not null default '{}'::jsonb check (jsonb_typeof(modifiers) = 'object'),
  created_at timestamptz not null default now()
);
create index daily_challenges_level_idx on public.daily_challenges (level_id);

create table public.streaks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current int not null default 0 check (current >= 0),
  longest int not null default 0 check (longest >= 0),
  last_played_date date,
  updated_at timestamptz not null default now()
);
create trigger streaks_updated_at before update on public.streaks
  for each row execute function public.set_updated_at();

-- Streak row for every new user.
create or replace function public.handle_new_profile_streak()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.streaks (user_id) values (new.id) on conflict do nothing;
  insert into public.player_level_progress (user_id, level_id, unlocked)
  select new.id, l.id, true from public.levels l where l.id in (0, 1)
  on conflict do nothing;
  return new;
end;
$$;
create trigger profiles_bootstrap_gameplay after insert on public.profiles
  for each row execute function public.handle_new_profile_streak();

-- ── Helpers ────────────────────────────────────────────────────────────
create or replace function public.is_my_active_group_member(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and g.facilitator_id = auth.uid() and gm.status = 'active'
  );
$$;
revoke execute on function public.is_my_active_group_member(uuid) from anon, public;
grant execute on function public.is_my_active_group_member(uuid) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.attempts enable row level security;
alter table public.attempt_events enable row level security;
alter table public.player_level_progress enable row level security;
alter table public.player_achievements enable row level security;
alter table public.player_tips enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.streaks enable row level security;

-- attempts: owner, facilitator of an active member's group, or moderators. No client writes.
create policy attempts_select_own on public.attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy attempts_select_facilitator on public.attempts for select to authenticated
  using ((select public.authorize('attempts.view_group')) and public.is_my_active_group_member(user_id));
create policy attempts_select_moderator on public.attempts for select to authenticated
  using ((select public.authorize('leaderboard.moderate')));
revoke insert, update, delete on public.attempts from authenticated, anon;

-- attempt_events: owner and moderators (for the event timeline view).
create policy attempt_events_select on public.attempt_events for select to authenticated using (
  (select public.authorize('leaderboard.moderate'))
  or exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = (select auth.uid()))
);
revoke insert, update, delete on public.attempt_events from authenticated, anon;

-- progress / achievements / tips / streaks: owner (and facilitators for progress).
create policy plp_select_own on public.player_level_progress for select to authenticated
  using (user_id = (select auth.uid()));
create policy plp_select_facilitator on public.player_level_progress for select to authenticated
  using ((select public.authorize('attempts.view_group')) and public.is_my_active_group_member(user_id));
create policy plp_select_admin on public.player_level_progress for select to authenticated
  using ((select public.authorize('users.manage')));
revoke insert, update, delete on public.player_level_progress from authenticated, anon;

create policy player_achievements_select_own on public.player_achievements for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.player_achievements from authenticated, anon;

create policy player_tips_select_own on public.player_tips for select to authenticated
  using (user_id = (select auth.uid()));
-- Players may mark an unlocked tip as read (cross-device continuity).
create policy player_tips_mark_read on public.player_tips for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.player_tips from authenticated, anon;
revoke update on public.player_tips from authenticated;
grant update (read_at) on public.player_tips to authenticated;

create policy daily_challenges_read on public.daily_challenges for select to anon, authenticated
  using (date <= (now() at time zone 'Asia/Manila')::date);
revoke insert, update, delete on public.daily_challenges from authenticated, anon;

create policy streaks_select_own on public.streaks for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.streaks from authenticated, anon;
