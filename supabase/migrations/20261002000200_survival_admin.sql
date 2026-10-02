-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · Survival Mode · Phase 9: admin tooling
-- Config publishing, chat-filter lists, chat hiding (audited), analytics, scoped settings.
-- ════════════════════════════════════════════════════════════════════

-- Admin-managed chat filter additions (versioned through the audit log on system_settings).
insert into public.system_settings (key, value, is_public) values
  ('survival_chat_wordlist', '{"words":[],"blockedPhrases":[],"version":1}', false)
on conflict (key) do nothing;

-- Scoped settings: admins (survival.config.manage) manage the chat switch + filter lists;
-- only super admins (survival.system.toggle) flip the Survival kill switch.
create policy system_settings_survival_read on public.system_settings for select to authenticated
  using (key like 'survival\_%' and (select public.authorize('survival.config.manage')));
create policy system_settings_survival_chat_update on public.system_settings for update to authenticated
  using (key in ('survival_chat_enabled', 'survival_chat_wordlist') and (select public.authorize('survival.config.manage')))
  with check (key in ('survival_chat_enabled', 'survival_chat_wordlist') and (select public.authorize('survival.config.manage')));
create policy system_settings_survival_toggle on public.system_settings for update to authenticated
  using (key in ('survival_enabled', 'survival_disabled_message') and (select public.authorize('survival.system.toggle')))
  with check (key in ('survival_enabled', 'survival_disabled_message') and (select public.authorize('survival.system.toggle')));

-- Publish a new config version atomically (the API validates it with the shared Zod schema
-- first). Running runs keep their pinned config_version_id.
create or replace function public.publish_survival_config(p_config jsonb, p_notes text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not public.authorize('survival.config.manage') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) <> 'object' then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('survival_config_publish'));
  select coalesce(max(version), 0) + 1 into v from public.survival_config_versions;
  update public.survival_config_versions set is_current = false where is_current;
  insert into public.survival_config_versions (version, config, is_current, notes, published_by)
  values (v, p_config, true, left(coalesce(p_notes, ''), 500), auth.uid());
  return v;
end;
$$;
revoke execute on function public.publish_survival_config(jsonb, text) from public, anon;
grant execute on function public.publish_survival_config(jsonb, text) to authenticated;

-- Hide a chat message (moderation). Audited; players never see hidden text again.
create or replace function public.admin_hide_survival_chat(p_message_id bigint, p_report_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_run uuid;
begin
  if not public.authorize('survival.reports.review') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.survival_chat_messages
  set status = 'hidden', hidden_by = auth.uid(), hidden_at = now()
  where id = p_message_id
  returning run_id into v_run;
  if v_run is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (auth.uid(), 'admin', 'hide:survival_chat', 'survival_chat_messages', p_message_id::text,
          jsonb_build_object('report_id', p_report_id, 'run_id', v_run));
  return v_run;
end;
$$;
revoke execute on function public.admin_hide_survival_chat(bigint, uuid) from public, anon;
grant execute on function public.admin_hide_survival_chat(bigint, uuid) to authenticated;

-- Survival analytics (Section 21.5) for staff dashboards.
create or replace function public.survival_admin_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  out jsonb;
begin
  if not (public.authorize('survival.reports.review') or public.authorize('survival.config.manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'by_difficulty', coalesce((
      select jsonb_agg(jsonb_build_object('difficulty', d.difficulty, 'started', d.started, 'completed', d.completed, 'rescued', d.rescued))
      from (
        select r.difficulty,
               count(*) filter (where r.status <> 'lobby') as started,
               count(*) filter (where r.status in ('completed', 'failed')) as completed,
               count(*) filter (where r.ending in ('full_rescue', 'partial_rescue')) as rescued
        from public.survival_runs r where r.created_at >= since group by r.difficulty
      ) d), '[]'::jsonb),
    'avg_days_survived', (select round(avg(days_survived)::numeric, 1) from public.survival_results where created_at >= since),
    'by_team_size', coalesce((
      select jsonb_agg(jsonb_build_object('team_size', t.team_size, 'runs', t.runs, 'full_rescue_rate', t.rate) order by t.team_size)
      from (
        select team_size, count(*) as runs,
               round(avg((ending = 'full_rescue')::int)::numeric, 2) as rate
        from public.survival_results where created_at >= since group by team_size
      ) t), '[]'::jsonb),
    'top_mistakes', coalesce((
      select jsonb_agg(jsonb_build_object('event_key', m.event_key, 'count', m.n) order by m.n desc)
      from (
        select event_key, count(*) as n from public.survival_learning_events
        where not is_positive and created_at >= since group by event_key order by n desc limit 10
      ) m), '[]'::jsonb),
    'top_good', coalesce((
      select jsonb_agg(jsonb_build_object('event_key', m.event_key, 'count', m.n) order by m.n desc)
      from (
        select event_key, count(*) as n from public.survival_learning_events
        where is_positive and created_at >= since group by event_key order by n desc limit 10
      ) m), '[]'::jsonb),
    'open_reports', (select count(*) from public.survival_reports where status = 'open'),
    'open_flags', (select count(*) from public.survival_chat_flags where status = 'open'),
    'active_restrictions', (select count(*) from public.survival_restrictions
                            where revoked_at is null and (ends_at is null or ends_at > now()))
  ) into out;
  return out;
end;
$$;
revoke execute on function public.survival_admin_analytics(int) from public, anon;
grant execute on function public.survival_admin_analytics(int) to authenticated;
