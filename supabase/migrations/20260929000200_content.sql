-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0002 · Game content (admin-managed)
-- ════════════════════════════════════════════════════════════════════

create table public.levels (
  id smallint primary key check (id between 0 and 99),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  sort_order int not null default 0,
  current_version_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger levels_updated_at before update on public.levels
  for each row execute function public.set_updated_at();

create table public.level_versions (
  id uuid primary key default gen_random_uuid(),
  level_id smallint not null references public.levels (id) on delete cascade,
  version int not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 32768),
  notes text,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  unique (level_id, version)
);
create index level_versions_level_idx on public.level_versions (level_id);
create index level_versions_published_by_idx on public.level_versions (published_by);

alter table public.levels
  add constraint levels_current_version_fk
  foreign key (current_version_id) references public.level_versions (id) on delete set null;
create index levels_current_version_idx on public.levels (current_version_id);

create table public.gobag_items (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  weight_kg numeric(5, 2) not null check (weight_kg > 0 and weight_kg <= 50),
  category text not null check (category in
    ('water', 'food', 'light', 'health', 'communication', 'documents', 'clothing', 'hygiene',
     'money', 'tools', 'pet', 'non_essential')),
  is_essential boolean not null default false,
  points int not null default 0 check (points between -500 and 500),
  explanation_fil text not null,
  explanation_en text not null,
  model_key text,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gobag_items_published_idx on public.gobag_items (is_published, sort_order);
create trigger gobag_items_updated_at before update on public.gobag_items
  for each row execute function public.set_updated_at();

create table public.home_tasks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  points int not null default 0 check (points between 0 and 500),
  explanation_fil text not null,
  explanation_en text not null,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index home_tasks_published_idx on public.home_tasks (is_published, sort_order);
create trigger home_tasks_updated_at before update on public.home_tasks
  for each row execute function public.set_updated_at();

create table public.hazards (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  penalty int not null default 0 check (penalty between 0 and 1000),
  instant_fail boolean not null default false,
  explanation_fil text not null,
  explanation_en text not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hazards_published_idx on public.hazards (is_published);
create trigger hazards_updated_at before update on public.hazards
  for each row execute function public.set_updated_at();

create table public.npc_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  needs jsonb not null default '{}'::jsonb check (jsonb_typeof(needs) = 'object'),
  points int not null default 0 check (points between 0 and 1000),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index npc_types_published_idx on public.npc_types (is_published);
create trigger npc_types_updated_at before update on public.npc_types
  for each row execute function public.set_updated_at();

create table public.tips (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  title_fil text not null,
  title_en text not null,
  body_fil text not null check (char_length(body_fil) <= 8000),
  body_en text not null check (char_length(body_en) <= 8000),
  category text not null check (category in
    ('before', 'during', 'after', 'gobag', 'home', 'evacuation', 'health', 'electricity', 'community')),
  -- e.g. {"type":"mistake","key":"live_wire"} | {"type":"level_complete","level":2} | {"type":"always"}
  unlock_rule jsonb not null default '{"type":"always"}'::jsonb check (jsonb_typeof(unlock_rule) = 'object'),
  needs_verification boolean not null default true,
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tips_published_idx on public.tips (is_published, category, sort_order);
create trigger tips_updated_at before update on public.tips
  for each row execute function public.set_updated_at();

create table public.hotlines (
  id uuid primary key default gen_random_uuid(),
  agency text not null check (char_length(agency) <= 120),
  number text not null check (number ~ '^[0-9+() -]{3,30}$'),
  area text not null default 'National',
  is_verified boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hotlines_active_idx on public.hotlines (is_active, sort_order);
create trigger hotlines_updated_at before update on public.hotlines
  for each row execute function public.set_updated_at();

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_fil text not null,
  name_en text not null,
  description_fil text not null,
  description_en text not null,
  icon_key text not null default 'medal',
  -- e.g. {"type":"level_complete","level":0} | {"type":"perfect_gobag"} | {"type":"streak","days":7}
  rule jsonb not null check (jsonb_typeof(rule) = 'object'),
  -- Avatar items unlocked with this achievement (no purchases).
  reward_items text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── RLS: published content is public; admins manage everything ─────────
alter table public.levels enable row level security;
alter table public.level_versions enable row level security;
alter table public.gobag_items enable row level security;
alter table public.home_tasks enable row level security;
alter table public.hazards enable row level security;
alter table public.npc_types enable row level security;
alter table public.tips enable row level security;
alter table public.hotlines enable row level security;
alter table public.achievements enable row level security;

create policy levels_read on public.levels for select to anon, authenticated using (is_active);
create policy level_versions_read on public.level_versions for select to anon, authenticated
  using (exists (select 1 from public.levels l where l.id = level_id and l.is_active));
create policy gobag_items_read on public.gobag_items for select to anon, authenticated using (is_published);
create policy home_tasks_read on public.home_tasks for select to anon, authenticated using (is_published);
create policy hazards_read on public.hazards for select to anon, authenticated using (is_published);
create policy npc_types_read on public.npc_types for select to anon, authenticated using (is_published);
create policy tips_read on public.tips for select to anon, authenticated using (is_published);
create policy hotlines_read on public.hotlines for select to anon, authenticated using (is_active);
create policy achievements_read on public.achievements for select to anon, authenticated using (true);

-- Admin full access (select unpublished + all writes).
do $$
declare t text;
begin
  foreach t in array array['levels', 'level_versions', 'gobag_items', 'home_tasks', 'hazards',
                           'npc_types', 'tips', 'hotlines', 'achievements']
  loop
    execute format(
      'create policy %1$s_admin_all on public.%1$I for all to authenticated
         using ((select public.authorize(''content.manage'')))
         with check ((select public.authorize(''content.manage'')))', t);
  end loop;
end $$;

-- Level versions are append-only (players mid-attempt keep the version they started).
create policy level_versions_no_update on public.level_versions as restrictive for update
  to authenticated using (false);
create policy level_versions_no_delete on public.level_versions as restrictive for delete
  to authenticated using (false);
