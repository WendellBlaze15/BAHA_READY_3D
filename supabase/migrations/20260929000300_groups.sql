-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0003 · Groups, membership, assignments, live sessions
-- ════════════════════════════════════════════════════════════════════

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  facilitator_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text check (char_length(description) <= 500),
  join_code text not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
  requires_approval boolean not null default false,
  max_members int not null default 60 check (max_members between 1 and 500),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index groups_facilitator_idx on public.groups (facilitator_id);
create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'active', 'removed')),
  joined_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);
create index group_members_status_idx on public.group_members (group_id, status);
create index group_members_decided_by_idx on public.group_members (decided_by);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  level_ids smallint[] not null check (cardinality(level_ids) between 1 and 6),
  min_stars smallint not null default 1 check (min_stars between 1 and 3),
  starts_at timestamptz not null default now(),
  due_at timestamptz not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (due_at > starts_at)
);
create index assignments_group_idx on public.assignments (group_id, due_at);
create index assignments_created_by_idx on public.assignments (created_by);

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  level_id smallint not null references public.levels (id),
  code text not null check (code ~ '^[A-Z2-9]{6}$'),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index live_sessions_group_idx on public.live_sessions (group_id, status);
create index live_sessions_level_idx on public.live_sessions (level_id);
create index live_sessions_created_by_idx on public.live_sessions (created_by);
create unique index live_sessions_active_code_idx on public.live_sessions (code) where status <> 'ended';

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('system', 'group')),
  group_id uuid references public.groups (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) <= 4000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((scope = 'system' and group_id is null) or (scope = 'group' and group_id is not null))
);
create index announcements_group_idx on public.announcements (group_id, created_at desc);
create index announcements_scope_idx on public.announcements (scope, created_at desc);
create index announcements_created_by_idx on public.announcements (created_by);

-- ── Helpers (security definer to avoid RLS recursion) ──────────────────
create or replace function public.generate_code6()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 32-symbol alphabet (no 0/O/1/I) divides 256 evenly, so there is no modulo bias.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(r.b, i) % 32), 1), '')
  from (select extensions.gen_random_bytes(6) as b) r, generate_series(0, 5) as i;
$$;

create or replace function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members
                 where group_id = gid and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_group_owner(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = gid and facilitator_id = auth.uid());
$$;

-- True when `uid` is an active/pending member of a group the caller facilitates.
create or replace function public.is_my_group_member(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and g.facilitator_id = auth.uid() and gm.status in ('active', 'pending')
  );
$$;

revoke execute on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.is_my_group_member(uuid), public.generate_code6() from anon, public;
grant execute on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.is_my_group_member(uuid) to authenticated;

-- Join codes are always generated server-side (client-supplied values are ignored).
create or replace function public.groups_assign_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  loop
    c := public.generate_code6();
    exit when not exists (select 1 from public.groups where join_code = c);
  end loop;
  new.join_code := c;
  return new;
end;
$$;
create trigger groups_assign_code before insert on public.groups
  for each row execute function public.groups_assign_code();

create or replace function public.live_sessions_assign_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  loop
    c := public.generate_code6();
    exit when not exists (select 1 from public.live_sessions where code = c and status <> 'ended');
  end loop;
  new.code := c;
  return new;
end;
$$;
create trigger live_sessions_assign_code before insert on public.live_sessions
  for each row execute function public.live_sessions_assign_code();

create or replace function public.group_members_track_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger group_members_track_decision before update on public.group_members
  for each row execute function public.group_members_track_decision();

-- ── RPC: join a group by code ──────────────────────────────────────────
create or replace function public.join_group(code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.groups;
  existing text;
  active_count int;
  new_status text;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if not public.authorize('groups.join') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if code is null or upper(trim(code)) !~ '^[A-Z2-9]{6}$' then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into g from public.groups
  where join_code = upper(trim(code)) and not is_archived;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select status into existing from public.group_members where group_id = g.id and user_id = uid;
  if existing in ('active', 'pending') then
    return jsonb_build_object('group_id', g.id, 'status', existing, 'already', true);
  end if;
  if existing = 'removed' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select count(*) into active_count from public.group_members
  where group_id = g.id and status = 'active';
  if active_count >= g.max_members then
    raise exception 'CONFLICT' using errcode = '23P01', detail = 'group_full';
  end if;

  new_status := case when g.requires_approval then 'pending' else 'active' end;
  insert into public.group_members (group_id, user_id, status) values (g.id, uid, new_status);
  return jsonb_build_object('group_id', g.id, 'status', new_status, 'already', false);
end;
$$;
revoke execute on function public.join_group(text) from anon, public;
grant execute on function public.join_group(text) to authenticated;

create or replace function public.regenerate_join_code(gid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare c text;
begin
  if not (public.is_group_owner(gid) and public.authorize('groups.manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  loop
    c := public.generate_code6();
    exit when not exists (select 1 from public.groups where join_code = c);
  end loop;
  update public.groups set join_code = c where id = gid;
  return c;
end;
$$;
revoke execute on function public.regenerate_join_code(uuid) from anon, public;
grant execute on function public.regenerate_join_code(uuid) to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.assignments enable row level security;
alter table public.live_sessions enable row level security;
alter table public.announcements enable row level security;

-- groups
create policy groups_select on public.groups for select to authenticated using (
  facilitator_id = (select auth.uid())
  or (select public.is_group_member(id))
  or (select public.authorize('users.manage'))
);
create policy groups_insert on public.groups for insert to authenticated with check (
  facilitator_id = (select auth.uid()) and (select public.authorize('groups.manage'))
);
create policy groups_update_owner on public.groups for update to authenticated
  using (facilitator_id = (select auth.uid()) and (select public.authorize('groups.manage')))
  with check (facilitator_id = (select auth.uid()));
create policy groups_update_admin on public.groups for update to authenticated
  using ((select public.authorize('users.manage')))
  with check ((select public.authorize('users.manage')));
revoke update on public.groups from authenticated;
grant update (name, description, requires_approval, max_members, is_archived) on public.groups to authenticated;
revoke delete on public.groups from authenticated, anon;

-- group_members
create policy group_members_select on public.group_members for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.is_group_owner(group_id))
  or (select public.authorize('users.manage'))
);
create policy group_members_update_owner on public.group_members for update to authenticated
  using ((select public.is_group_owner(group_id)) and (select public.authorize('groups.manage')))
  with check ((select public.is_group_owner(group_id)));
create policy group_members_leave on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) and status <> 'removed');
revoke insert on public.group_members from authenticated, anon;
revoke update on public.group_members from authenticated;
grant update (status) on public.group_members to authenticated;

-- assignments
create policy assignments_select on public.assignments for select to authenticated using (
  (select public.is_group_owner(group_id))
  or (select public.is_group_member(group_id))
  or (select public.authorize('users.manage'))
);
create policy assignments_write on public.assignments for all to authenticated
  using ((select public.is_group_owner(group_id)) and (select public.authorize('assignments.manage')))
  with check (
    (select public.is_group_owner(group_id))
    and (select public.authorize('assignments.manage'))
    and created_by = (select auth.uid())
  );

-- live_sessions (writes normally via the live-session Edge Function)
create policy live_sessions_select on public.live_sessions for select to authenticated using (
  (select public.is_group_owner(group_id)) or (select public.is_group_member(group_id))
);
create policy live_sessions_write on public.live_sessions for all to authenticated
  using ((select public.is_group_owner(group_id)) and (select public.authorize('groups.manage')))
  with check (
    (select public.is_group_owner(group_id))
    and (select public.authorize('groups.manage'))
    and created_by = (select auth.uid())
  );

-- announcements
create policy announcements_select on public.announcements for select to authenticated using (
  scope = 'system'
  or (select public.is_group_member(group_id))
  or (select public.is_group_owner(group_id))
  or (select public.authorize('users.manage'))
);
create policy announcements_insert on public.announcements for insert to authenticated with check (
  created_by = (select auth.uid())
  and (
    (scope = 'group' and (select public.is_group_owner(group_id)) and (select public.authorize('groups.manage')))
    or (scope = 'system' and (select public.authorize('announcements.system')))
  )
);
create policy announcements_delete on public.announcements for delete to authenticated using (
  created_by = (select auth.uid()) or (select public.authorize('announcements.system'))
);
revoke update on public.announcements from authenticated, anon;

-- Facilitators can read the profiles of their own group members.
create policy profiles_select_group_owner on public.profiles for select to authenticated
  using ((select public.is_my_group_member(id)));
