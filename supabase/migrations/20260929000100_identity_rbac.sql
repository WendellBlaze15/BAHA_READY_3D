-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0001 · Extensions, identity, RBAC
-- ════════════════════════════════════════════════════════════════════

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ── Generic updated_at trigger ─────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Roles & permissions ────────────────────────────────────────────────
create table public.roles (
  id smallint primary key,
  name text not null unique
);

create table public.permissions (
  id smallint primary key,
  name text not null unique,
  -- DECISION: staff permissions require an aal2 (TOTP) session unless the super admin
  -- disables `require_staff_mfa` in system_settings (audited).
  requires_mfa boolean not null default false
);

create table public.role_permissions (
  role_id smallint not null references public.roles (id) on delete cascade,
  permission_id smallint not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);
create index role_permissions_permission_idx on public.role_permissions (permission_id);

insert into public.roles (id, name) values
  (1, 'guest'), (2, 'player'), (3, 'facilitator'), (4, 'admin'), (5, 'super_admin');

insert into public.permissions (id, name, requires_mfa) values
  (1,  'levels.play_all',       false),
  (2,  'leaderboard.appear',    false),
  (3,  'groups.join',           false),
  (4,  'facilitator.apply',     false),
  (10, 'groups.manage',         true),
  (11, 'assignments.manage',    true),
  (12, 'attempts.view_group',   true),
  (13, 'reports.export',        true),
  (20, 'applications.review',   true),
  (21, 'content.manage',        true),
  (22, 'leaderboard.moderate',  true),
  (23, 'users.manage',          true),
  (24, 'audit.read',            true),
  (25, 'announcements.system',  true),
  (30, 'admins.manage',         true),
  (31, 'system.manage',         true),
  (32, 'audit.read_all',        true);

-- player
insert into public.role_permissions (role_id, permission_id)
select 2, id from public.permissions where name in
  ('levels.play_all', 'leaderboard.appear', 'groups.join', 'facilitator.apply');
-- facilitator
insert into public.role_permissions (role_id, permission_id)
select 3, id from public.permissions where name in
  ('levels.play_all', 'leaderboard.appear', 'groups.manage', 'assignments.manage',
   'attempts.view_group', 'reports.export');
-- admin
insert into public.role_permissions (role_id, permission_id)
select 4, id from public.permissions where name in
  ('levels.play_all', 'groups.manage', 'assignments.manage', 'attempts.view_group',
   'reports.export', 'applications.review', 'content.manage', 'leaderboard.moderate',
   'users.manage', 'audit.read', 'announcements.system');
-- super_admin: everything
insert into public.role_permissions (role_id, permission_id)
select 5, id from public.permissions where name <> 'leaderboard.appear' and name <> 'groups.join'
  and name <> 'facilitator.apply';

-- ── Profiles ───────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    check (username::text ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  avatar_key text check (char_length(avatar_key) <= 64),
  avatar_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(avatar_config) = 'object' and pg_column_size(avatar_config) < 4096),
  barangay text check (char_length(barangay) <= 80),
  school text check (char_length(school) <= 120),
  language text not null default 'fil' check (language in ('fil', 'en')),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  suspended_until timestamptz,
  suspension_reason text,
  deleted_at timestamptz,
  leaderboard_visible boolean not null default true,
  is_minor boolean,
  -- DECISION: nullable because the placeholder row is created at sign-up, before the
  -- onboarding consent step. Middleware blocks play until consent_at is set.
  consent_at timestamptz,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_status_idx on public.profiles (status);
create index profiles_barangay_idx on public.profiles (barangay);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id smallint not null references public.roles (id),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles (role_id);
create index user_roles_granted_by_idx on public.user_roles (granted_by);

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  graphics_quality text not null default 'auto'
    check (graphics_quality in ('auto', 'low', 'medium', 'high')),
  audio jsonb not null default '{"master":0.8,"music":0.6,"sfx":0.8,"voice":0.9}'::jsonb,
  controls jsonb not null default '{"joystickSize":"md","invertCamera":false}'::jsonb,
  text_scale numeric(3, 2) not null default 1.00 check (text_scale between 1.00 and 1.50),
  reduced_motion boolean not null default false,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  notifications jsonb not null default
    '{"email":true,"push":true,"dailyReminder":true,"dailyReminderTime":"18:00","marketing":false}'::jsonb,
  updated_at timestamptz not null default now(),
  check (pg_column_size(audio) < 1024 and pg_column_size(controls) < 1024
         and pg_column_size(notifications) < 2048)
);
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('web', 'android', 'ios')),
  -- Encrypted at the application layer (AES-GCM) before insert; never stored in plaintext.
  push_token_encrypted text,
  device_name text check (char_length(device_name) <= 80),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index user_devices_user_idx on public.user_devices (user_id);

-- ── System settings (needed by authorize) ──────────────────────────────
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index system_settings_updated_by_idx on public.system_settings (updated_by);
create trigger system_settings_updated_at before update on public.system_settings
  for each row execute function public.set_updated_at();

insert into public.system_settings (key, value, is_public) values
  ('maintenance', '{"enabled":false,"message_fil":"","message_en":""}', true),
  ('require_staff_mfa', 'true', false),
  ('feature_flags', '{"realWeather":true,"dailyChallenge":true,"liveSessions":true,"smsOtp":false}', true),
  ('daily_challenge', '{"levels":[1,2,3,4,5]}', false),
  ('rate_limits', '{
     "otp_request_email":{"limit":3,"window":"15 m"},
     "otp_request_ip":{"limit":10,"window":"1 h"},
     "otp_verify":{"limit":5,"window":"15 m"},
     "signup_ip":{"limit":5,"window":"1 h"},
     "password_signin":{"limit":10,"window":"15 m"},
     "start_attempt":{"limit":20,"window":"10 m"},
     "submit_attempt":{"limit":20,"window":"10 m"},
     "join_group":{"limit":10,"window":"1 h"},
     "facilitator_application":{"limit":3,"window":"1 d"},
     "report_export":{"limit":10,"window":"1 h"},
     "content_write":{"limit":120,"window":"1 m"},
     "leaderboard_read":{"limit":60,"window":"1 m"},
     "weather":{"limit":30,"window":"1 m"},
     "general":{"limit":300,"window":"5 m"}
   }', false);

-- ── Authorization helpers ──────────────────────────────────────────────
-- DECISION: authorize() checks the live tables instead of trusting JWT claims, so
-- suspensions and role removals take effect immediately (JWT claims can be up to 1h stale).
-- JWT claims (user_role, permissions) are still injected for fast UI/middleware checks.
create or replace function public.authorize(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and p.name = requested_permission
      and pr.status = 'active'
      and (
        not p.requires_mfa
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        or coalesce((select s.value::text from public.system_settings s
                     where s.key = 'require_staff_mfa'), 'true') = 'false'
      )
  );
$$;

create or replace function public.has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and r.name = role_name and p.status = 'active'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

revoke execute on function public.authorize(text) from anon, public;
revoke execute on function public.has_role(text) from anon, public;
revoke execute on function public.is_active_user() from anon, public;
grant execute on function public.authorize(text) to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- ── Custom access token hook ───────────────────────────────────────────
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
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.user_roles, public.roles, public.role_permissions, public.permissions,
  public.profiles to supabase_auth_admin;

-- ── New user bootstrap ─────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
  lang text := coalesce(new.raw_user_meta_data ->> 'language', 'fil');
begin
  insert into public.profiles (id, username, language)
  values (new.id, base, case when lang in ('fil', 'en') then lang else 'fil' end);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.user_roles (user_id, role_id) values (new.id, 2);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_devices enable row level security;
alter table public.system_settings enable row level security;

-- Lookup tables: readable by signed-in users; writes only via migrations/service role.
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- Auth hook needs to read these.
create policy auth_admin_read_roles on public.user_roles for select to supabase_auth_admin using (true);
create policy auth_admin_read_profiles on public.profiles for select to supabase_auth_admin using (true);
create policy auth_admin_read_roles_tbl on public.roles for select to supabase_auth_admin using (true);
create policy auth_admin_read_perms on public.permissions for select to supabase_auth_admin using (true);
create policy auth_admin_read_rp on public.role_permissions for select to supabase_auth_admin using (true);

-- profiles
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_select_admin on public.profiles for select to authenticated
  using ((select public.authorize('users.manage')));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and status = 'active')
  with check (id = (select auth.uid()) and status = 'active');

-- Column-level: users may only change these columns on their own row.
revoke update on public.profiles from authenticated, anon;
grant update (username, display_name, avatar_key, avatar_config, barangay, school, language,
  leaderboard_visible, is_minor, consent_at, onboarded_at) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- user_roles: see own roles; admins see all. Writes only via Edge Functions (service role).
create policy user_roles_select_own on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_roles_select_admin on public.user_roles for select to authenticated
  using ((select public.authorize('users.manage')));
revoke insert, update, delete on public.user_roles from authenticated, anon;

-- user_settings: owner read/update.
create policy user_settings_select_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_user()))
  with check (user_id = (select auth.uid()));
revoke insert, delete on public.user_settings from authenticated, anon;

-- user_devices: owner read/delete (sign out device); inserts via server.
create policy user_devices_select_own on public.user_devices for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_devices_delete_own on public.user_devices for delete to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update on public.user_devices from authenticated, anon;

-- system_settings: public keys readable by everyone (maintenance banner); super admin writes.
create policy system_settings_read_public on public.system_settings for select to anon, authenticated
  using (is_public);
create policy system_settings_read_admin on public.system_settings for select to authenticated
  using ((select public.authorize('system.manage')));
create policy system_settings_update on public.system_settings for update to authenticated
  using ((select public.authorize('system.manage')))
  with check ((select public.authorize('system.manage')));
revoke insert, delete on public.system_settings from authenticated, anon;
