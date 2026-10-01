-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · Survival Mode · Phase 7: results, rewards, achievements, resume notices
-- All functions here are SERVER-ONLY (game server, service role).
-- ════════════════════════════════════════════════════════════════════

-- Finish a run atomically and idempotently: results row, run status, per-player totals,
-- reward cosmetics, achievements, tips (from mistakes) and notifications.
--
-- p_result = {
--   ending, days_survived, final_score, base_score, team_size, real_minutes, boat_stage,
--   learning_summary: {...}, all_npcs_rescued: bool, team_deaths: int, total_days: int,
--   players: { "<uid>": { rescued, survived, deaths, revives_given, boat_stages_built,
--                         nights_survived, drank_unsafe, tip_keys: [..] } }
-- }
create or replace function public.finish_survival_run(p_run_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.survival_runs;
  v_ending text := p_result ->> 'ending';
  v_days int := (p_result ->> 'days_survived')::int;
  v_team int := (p_result ->> 'team_size')::int;
  v_team_deaths int := coalesce((p_result ->> 'team_deaths')::int, 0);
  v_total_days int := coalesce((p_result ->> 'total_days')::int, 30);
  v_all_npcs boolean := coalesce((p_result ->> 'all_npcs_rescued')::boolean, false);
  uid uuid;
  pl jsonb;
  st public.survival_player_stats;
  ci record;
  ach record;
  earned boolean;
  out_rewards jsonb := '{}'::jsonb;
  out_ach jsonb := '{}'::jsonb;
  got text[];
  got_ach text[];
begin
  if v_ending not in ('full_rescue', 'partial_rescue', 'failed') then
    raise exception 'bad ending';
  end if;
  select * into r from public.survival_runs where id = p_run_id for update;
  if not found then raise exception 'run not found'; end if;
  -- Idempotent: a second call (e.g. retry after a timeout) changes nothing.
  if exists (select 1 from public.survival_results where run_id = p_run_id) then
    return jsonb_build_object('already', true);
  end if;

  insert into public.survival_results (run_id, ending, days_survived, final_score, difficulty, team_size,
                                       real_minutes_played, learning_summary, per_player)
  values (p_run_id, v_ending, v_days, (p_result ->> 'final_score')::int, r.difficulty, v_team,
          coalesce((p_result ->> 'real_minutes')::int, 0),
          coalesce(p_result -> 'learning_summary', '{}'::jsonb), coalesce(p_result -> 'players', '{}'::jsonb));

  update public.survival_runs
  set status = case when v_ending = 'failed' then 'failed' else 'completed' end,
      ending = v_ending, final_score = (p_result ->> 'final_score')::int,
      current_day = least(31, greatest(1, v_days)),
      boat_stage = least(6, greatest(0, coalesce((p_result ->> 'boat_stage')::int, r.boat_stage))),
      ended_at = now()
  where id = p_run_id;

  for uid, pl in select key::uuid, value from jsonb_each(coalesce(p_result -> 'players', '{}'::jsonb)) loop
    -- Only real members of this run get credit.
    continue when not exists (select 1 from public.survival_run_members m where m.run_id = p_run_id and m.user_id = uid);

    update public.survival_run_members
    set deaths = coalesce((pl ->> 'deaths')::int, 0), revives_given = coalesce((pl ->> 'revives_given')::int, 0)
    where run_id = p_run_id and user_id = uid;

    insert into public.survival_player_stats as s (user_id, runs_completed, full_rescues, nights_survived, revives_given, boat_stages_built)
    values (uid, 1, (v_ending = 'full_rescue')::int, coalesce((pl ->> 'nights_survived')::int, 0),
            coalesce((pl ->> 'revives_given')::int, 0), coalesce((pl ->> 'boat_stages_built')::int, 0))
    on conflict (user_id) do update set
      runs_completed = s.runs_completed + 1,
      full_rescues = s.full_rescues + excluded.full_rescues,
      nights_survived = s.nights_survived + excluded.nights_survived,
      revives_given = s.revives_given + excluded.revives_given,
      boat_stages_built = s.boat_stages_built + excluded.boat_stages_built
    returning * into st;

    -- Reward cosmetics (Section 15.1).
    got := '{}';
    for ci in select * from public.cosmetic_items where is_reward loop
      earned := case ci.unlock_rule ->> 'type'
        when 'survival_ending' then
          coalesce((pl ->> 'rescued')::boolean, false)
          and v_ending in (select jsonb_array_elements_text(ci.unlock_rule -> 'ending'))
          and (ci.unlock_rule ->> 'difficulty' is null or ci.unlock_rule ->> 'difficulty' = r.difficulty)
        when 'survival_total' then
          case ci.unlock_rule ->> 'stat'
            when 'revives_given' then st.revives_given
            when 'boat_stages_built' then st.boat_stages_built
            when 'nights_survived' then st.nights_survived
            else 0 end >= (ci.unlock_rule ->> 'min')::int
        else false end;
      if earned and not exists (select 1 from public.player_cosmetics pc where pc.user_id = uid and pc.item_key = ci.key) then
        insert into public.player_cosmetics (user_id, item_key) values (uid, ci.key);
        got := got || ci.key;
        perform public.notify_user(uid, 'survival_reward', '🎁 ' || ci.name_fil || ' · ' || ci.name_en,
          'Bagong gamit sa Avatar Studio!', jsonb_build_object('href', '/profile/avatar', 'key', ci.key));
      end if;
    end loop;
    if array_length(got, 1) > 0 then out_rewards := out_rewards || jsonb_build_object(uid::text, to_jsonb(got)); end if;

    -- Achievements (Section 15.2).
    got_ach := '{}';
    for ach in select * from public.achievements where key like 'survival\_%' loop
      earned := case ach.rule ->> 'type'
        when 'survival_days' then v_days >= (ach.rule ->> 'days')::int and coalesce((pl ->> 'survived')::boolean, false)
        when 'survival_ending' then
          coalesce((pl ->> 'rescued')::boolean, false)
          and v_ending = ach.rule ->> 'ending'
          and (ach.rule ->> 'team_size' is null or (ach.rule ->> 'team_size')::int = v_team)
          and (ach.rule ->> 'difficulty' is null or ach.rule ->> 'difficulty' = r.difficulty)
          and (ach.rule ->> 'deaths' is null or v_team_deaths <= (ach.rule ->> 'deaths')::int)
        when 'survival_no_event' then
          v_days >= v_total_days and not coalesce((pl ->> 'drank_unsafe')::boolean, true)
        when 'survival_all_npcs' then v_all_npcs
        else false end;
      if earned and not exists (select 1 from public.player_achievements pa where pa.user_id = uid and pa.achievement_id = ach.id) then
        insert into public.player_achievements (user_id, achievement_id) values (uid, ach.id);
        got_ach := got_ach || ach.key;
        perform public.notify_user(uid, 'achievement', '🏅 ' || ach.name_fil || ' · ' || ach.name_en,
          ach.description_fil, jsonb_build_object('href', '/achievements', 'key', ach.key));
      end if;
    end loop;
    if array_length(got_ach, 1) > 0 then out_ach := out_ach || jsonb_build_object(uid::text, to_jsonb(got_ach)); end if;

    -- Tips Library cards for the lessons this player met ("Mga Natutunan").
    insert into public.player_tips (user_id, tip_id)
    select uid, t.id from public.tips t
    where t.is_published and t.unlock_rule ->> 'type' = 'mistake'
      and (t.unlock_rule ->> 'key') in (select jsonb_array_elements_text(coalesce(pl -> 'tip_keys', '[]'::jsonb)))
    on conflict do nothing;

    perform public.notify_user(uid, 'survival_run_ended',
      case v_ending when 'full_rescue' then '🚁 Ligtas kayong lahat!' when 'partial_rescue' then '🚁 May nailigtas!' else '🌊 Hindi nakaligtas' end,
      'Tingnan ang inyong "Mga Natutunan".', jsonb_build_object('href', '/survival/runs/' || p_run_id, 'ending', v_ending));
  end loop;

  return jsonb_build_object('rewards', out_rewards, 'achievements', out_ach);
end;
$$;
revoke execute on function public.finish_survival_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_survival_run(uuid, jsonb) to service_role;

-- "Nagbukas si Brian ng inyong laro (Day 12)" → every other active member.
create or replace function public.notify_survival_resumed(p_run_id uuid, p_by uuid, p_day int, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m record;
  uname text;
begin
  select username into uname from public.profiles where id = p_by;
  for m in select user_id from public.survival_run_members where run_id = p_run_id and status = 'active' and user_id <> p_by loop
    perform public.notify_user(m.user_id, 'survival_resumed',
      '🎮 Nagbukas si ' || coalesce(uname, 'kasama') || ' ng inyong laro (Day ' || p_day || ')',
      'Sumali na para tumulong!', jsonb_build_object('href', '/survival/join/' || p_code, 'run_id', p_run_id, 'code', p_code));
  end loop;
end;
$$;
revoke execute on function public.notify_survival_resumed(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.notify_survival_resumed(uuid, uuid, int, text) to service_role;

-- Expiry warnings also go out by email (Brevo template survival_run_expiring).
create or replace function public.survival_maintenance()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Warn 3 days before a paused run expires (not resumed in 30 days), then expire it.
  for r in
    select sr.id, sr.current_day, m.user_id from public.survival_runs sr
    join public.survival_run_members m on m.run_id = sr.id and m.status = 'active'
    where sr.status in ('lobby', 'active') and not sr.expiry_warned
      and coalesce(sr.last_session_at, sr.created_at) < now() - interval '27 days'
  loop
    perform public.notify_user(r.user_id, 'survival_run_expiring', '⏳ Mag-e-expire ang inyong Survival run',
      'Ituloy ang laro sa loob ng 3 araw para hindi ito mawala.', jsonb_build_object('href', '/survival'));
    perform public.enqueue_email(r.user_id, 'survival_run_expiring',
      jsonb_build_object('day', r.current_day, 'href', '/survival'));
  end loop;
  update public.survival_runs set expiry_warned = true
  where status in ('lobby', 'active') and not expiry_warned
    and coalesce(last_session_at, created_at) < now() - interval '27 days';
  update public.survival_runs set status = 'expired', ended_at = now()
  where status in ('lobby', 'active') and coalesce(last_session_at, created_at) < now() - interval '30 days';
  -- Lobbies that never started are cleaned up after a day.
  update public.survival_runs set status = 'abandoned', ended_at = now()
  where status = 'lobby' and created_at < now() - interval '1 day';

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

-- One live session per run (resume never forks a run).
create unique index if not exists survival_sessions_one_open_idx
  on public.survival_sessions (run_id) where ended_at is null;
