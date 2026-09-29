-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0005 · Platform: applications, notifications, email, reports, audit
-- ════════════════════════════════════════════════════════════════════

create table public.facilitator_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  organization text not null check (char_length(organization) between 2 and 160),
  position text not null check (char_length(position) between 2 and 120),
  contact text not null check (char_length(contact) between 5 and 120),
  proof_path text check (proof_path is null or proof_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_note text check (char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (status <> 'rejected' or review_note is not null)
);
create index facilitator_applications_user_idx on public.facilitator_applications (user_id);
create index facilitator_applications_status_idx on public.facilitator_applications (status, created_at);
create index facilitator_applications_reviewer_idx on public.facilitator_applications (reviewer_id);
create unique index facilitator_applications_one_pending_idx
  on public.facilitator_applications (user_id) where status = 'pending';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (char_length(type) <= 60),
  title text not null check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 1000),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 4096),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Service-role only: never exposed to clients.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  to_email extensions.citext not null,
  template_key text not null check (template_key ~ '^[a-z0-9_]{2,60}$'),
  params jsonb not null default '{}'::jsonb check (pg_column_size(params) < 8192),
  locale text not null default 'fil' check (locale in ('fil', 'en')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed')),
  attempts smallint not null default 0,
  last_error text,
  provider_message_id text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_user_idx on public.email_outbox (user_id);
create index email_outbox_retry_idx on public.email_outbox (next_attempt_at) where status = 'queued';

create table public.email_suppressions (
  email extensions.citext primary key,
  reason text not null check (reason in ('hard_bounce', 'spam', 'unsubscribed', 'blocked')),
  created_at timestamptz not null default now()
);

create table public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('group_csv', 'group_pdf', 'assignment_csv', 'assignment_pdf',
                                     'system_csv', 'account_export', 'live_session_summary')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  file_path text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index report_jobs_requested_by_idx on public.report_jobs (requested_by, created_at desc);

create table public.audit_logs (
  id bigserial primary key,
  -- No FK: audit history must survive account deletion.
  actor_id uuid,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

-- ── Audit trigger ──────────────────────────────────────────────────────
create or replace function public.current_request_ip()
returns inet language plpgsql stable set search_path = '' as $$
declare h json; v text;
begin
  h := nullif(current_setting('request.headers', true), '')::json;
  v := split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1);
  return nullif(trim(v), '')::inet;
exception when others then
  return null;
end;
$$;

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_rec jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  old_rec jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  target text;
  role_name text;
  h json;
begin
  target := coalesce(new_rec ->> 'id', old_rec ->> 'id', new_rec ->> 'user_id', old_rec ->> 'user_id',
                     new_rec ->> 'key', old_rec ->> 'key');
  -- Never copy secrets into the audit log.
  new_rec := new_rec - 'push_token_encrypted';
  old_rec := old_rec - 'push_token_encrypted';

  select r.name into role_name from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid() order by r.id desc limit 1;

  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null;
  end;

  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, ip, user_agent)
  values (
    auth.uid(),
    coalesce(role_name, case when auth.uid() is null then 'system' end),
    lower(tg_op) || ':' || tg_table_name,
    tg_table_name,
    target,
    jsonb_strip_nulls(jsonb_build_object('old', old_rec, 'new', new_rec)),
    public.current_request_ip(),
    left(h ->> 'user-agent', 300)
  );
  return coalesce(new, old);
end;
$$;

-- Sensitive tables
create trigger audit_user_roles after insert or delete on public.user_roles
  for each row execute function public.audit_trigger();
create trigger audit_profiles_status after update of status on public.profiles
  for each row when (old.status is distinct from new.status) execute function public.audit_trigger();
create trigger audit_attempts_void after update of status on public.attempts
  for each row when ((new.status = 'voided') <> (old.status = 'voided')) execute function public.audit_trigger();
create trigger audit_level_versions after insert on public.level_versions
  for each row execute function public.audit_trigger();
create trigger audit_system_settings after insert or update or delete on public.system_settings
  for each row execute function public.audit_trigger();
create trigger audit_facilitator_applications after update of status on public.facilitator_applications
  for each row when (old.status is distinct from new.status) execute function public.audit_trigger();
create trigger audit_group_members_removed after update of status on public.group_members
  for each row when (new.status = 'removed' and old.status <> 'removed') execute function public.audit_trigger();

do $$
declare t text;
begin
  foreach t in array array['levels', 'gobag_items', 'home_tasks', 'hazards', 'npc_types', 'tips',
                           'hotlines', 'achievements', 'announcements']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.facilitator_applications enable row level security;
alter table public.notifications enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.report_jobs enable row level security;
alter table public.audit_logs enable row level security;

-- facilitator_applications
create policy fa_insert_own on public.facilitator_applications for insert to authenticated with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewer_id is null
  and review_note is null
  and reviewed_at is null
  and (select public.authorize('facilitator.apply'))
);
create policy fa_select_own on public.facilitator_applications for select to authenticated
  using (user_id = (select auth.uid()));
create policy fa_select_reviewer on public.facilitator_applications for select to authenticated
  using ((select public.authorize('applications.review')));
-- Status changes happen in the approve-facilitator Edge Function (service role).
revoke update, delete on public.facilitator_applications from authenticated, anon;

-- notifications: owner reads and marks read.
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke insert on public.notifications from authenticated, anon;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- email_outbox / email_suppressions: no client access at all.
revoke all on public.email_outbox from anon, authenticated;
revoke all on public.email_suppressions from anon, authenticated;

-- report_jobs: requester reads own.
create policy report_jobs_select_own on public.report_jobs for select to authenticated
  using (requested_by = (select auth.uid()));
revoke insert, update, delete on public.report_jobs from authenticated, anon;

-- audit_logs: admins read non-staff actions; super admins read everything. Inserts via trigger only.
create policy audit_logs_select_admin on public.audit_logs for select to authenticated using (
  (select public.authorize('audit.read'))
  and coalesce(actor_role, 'system') not in ('admin', 'super_admin')
);
create policy audit_logs_select_all on public.audit_logs for select to authenticated
  using ((select public.authorize('audit.read_all')));
revoke insert, update, delete on public.audit_logs from authenticated, anon;
