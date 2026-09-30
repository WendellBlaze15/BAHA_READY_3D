-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0010 · Attempt finalization (called by the submit-attempt Edge Function)
-- One transaction: attempt row, progress (never decreases), next-level unlock, daily streak,
-- personalized tips, achievements, notifications, realtime broadcasts.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.finalize_attempt(p_attempt_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.attempts;
  flagged boolean := jsonb_array_length(coalesce(p_result -> 'flags', '[]'::jsonb)) > 0;
  completed boolean := p_result ->> 'outcome' = 'completed';
  v_score int := (p_result ->> 'score')::int;
  v_stars smallint := (p_result ->> 'stars')::smallint;
  today date := (now() at time zone 'Asia/Manila')::date;
  new_tips jsonb := '[]'::jsonb;
  new_ach jsonb := '[]'::jsonb;
  unlocked smallint := null;
  st public.streaks;
  ach record;
  earned boolean;
  gid uuid;
begin
  select * into a from public.attempts where id = p_attempt_id for update;
  if not found or a.status <> 'in_progress' then
    raise exception 'CONFLICT' using errcode = '23P01';
  end if;

  update public.attempts set
    status = case when completed then 'completed' else 'failed' end,
    score = v_score,
    stars = v_stars,
    duration_ms = (p_result ->> 'durationMs')::int,
    npcs_rescued = (p_result ->> 'npcsRescued')::smallint,
    hazard_hits = (p_result ->> 'hazardHits')::smallint,
    summary = p_result - 'events',
    flag_reasons = coalesce(array(select jsonb_array_elements_text(p_result -> 'flags')), '{}'),
    finished_at = now()
  where id = p_attempt_id;

  -- Progress: attempts always count; best score/stars only from clean runs, never decrease.
  insert into public.player_level_progress (user_id, level_id, best_score, best_stars, attempts_count, unlocked)
  values (a.user_id, a.level_id, case when flagged then 0 else v_score end,
          case when flagged then 0 else v_stars end, 1, true)
  on conflict (user_id, level_id) do update set
    best_score = greatest(public.player_level_progress.best_score, excluded.best_score),
    best_stars = greatest(public.player_level_progress.best_stars, excluded.best_stars),
    attempts_count = public.player_level_progress.attempts_count + 1;

  if flagged then
    return jsonb_build_object('new_tips', new_tips, 'new_achievements', new_ach, 'unlocked_level', null, 'flagged', true);
  end if;

  -- Unlock the next level after surviving (≥ 1 star).
  if completed and v_stars >= 1 and exists (select 1 from public.levels where id = a.level_id + 1 and is_active) then
    insert into public.player_level_progress (user_id, level_id, unlocked)
    values (a.user_id, a.level_id + 1, true)
    on conflict (user_id, level_id) do update set unlocked = true
    where not public.player_level_progress.unlocked;
    if found then unlocked := a.level_id + 1; end if;
  end if;

  -- Daily challenge streak (Asia/Manila days).
  if a.mode = 'daily' and completed then
    select * into st from public.streaks where user_id = a.user_id for update;
    if st.last_played_date is distinct from today then
      update public.streaks set
        current = case when st.last_played_date = today - 1 then st.current + 1 else 1 end,
        longest = greatest(st.longest, case when st.last_played_date = today - 1 then st.current + 1 else 1 end),
        last_played_date = today
      where user_id = a.user_id;
    end if;
  end if;

  -- Personalized tips: mistakes made + level completion.
  with ins as (
    insert into public.player_tips (user_id, tip_id)
    select a.user_id, t.id from public.tips t
    where t.is_published and (
      (t.unlock_rule ->> 'type' = 'mistake'
        and (t.unlock_rule ->> 'key') in (select jsonb_array_elements_text(p_result -> 'mistakes')))
      or (completed and t.unlock_rule ->> 'type' = 'level_complete' and (t.unlock_rule ->> 'level')::int <= a.level_id)
    )
    on conflict do nothing
    returning tip_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'title_fil', t.title_fil, 'title_en', t.title_en)), '[]')
    into new_tips
  from ins join public.tips t on t.id = ins.tip_id;

  -- Achievements.
  select * into st from public.streaks where user_id = a.user_id;
  for ach in select * from public.achievements loop
    continue when exists (select 1 from public.player_achievements where user_id = a.user_id and achievement_id = ach.id);
    earned := case ach.rule ->> 'type'
      when 'level_complete' then completed and a.level_id = (ach.rule ->> 'level')::int
      when 'perfect_gobag' then completed and coalesce((p_result ->> 'perfectGobag')::boolean, false)
      when 'all_npcs' then completed and a.level_id = (ach.rule ->> 'level')::int
        and (p_result ->> 'npcsRescued')::int = (p_result ->> 'npcsTotal')::int and (p_result ->> 'npcsTotal')::int > 0
      when 'no_hazards' then completed and (p_result ->> 'hazardHits')::int = 0 and a.level_id > 0
      when 'streak' then coalesce(st.current, 0) >= (ach.rule ->> 'days')::int
      when 'all_levels_stars' then (
        select count(*) = (select count(*) from public.levels where is_active and id > 0)
        from public.player_level_progress p
        where p.user_id = a.user_id and p.level_id > 0 and p.best_stars >= (ach.rule ->> 'stars')::int)
      when 'level_complete_with_item' then completed and a.level_id = (ach.rule ->> 'level')::int
        and (p_result -> 'packed') ? (ach.rule ->> 'item')
      else false
    end;
    if earned then
      insert into public.player_achievements (user_id, achievement_id) values (a.user_id, ach.id) on conflict do nothing;
      new_ach := new_ach || jsonb_build_object('key', ach.key, 'name_fil', ach.name_fil, 'name_en', ach.name_en, 'icon_key', ach.icon_key);
      perform public.notify_user(a.user_id, 'achievement', '🏅 ' || ach.name_fil || ' · ' || ach.name_en,
        ach.description_fil, jsonb_build_object('href', '/achievements', 'key', ach.key));
    end if;
  end loop;

  -- Live updates for facilitators of this player's groups.
  for gid in select group_id from public.group_members where user_id = a.user_id and status = 'active' loop
    perform realtime.send(jsonb_build_object('user_id', a.user_id, 'level_id', a.level_id, 'stars', v_stars),
                          'attempt_completed', 'group:' || gid::text, true);
  end loop;

  return jsonb_build_object('new_tips', new_tips, 'new_achievements', new_ach, 'unlocked_level', unlocked, 'flagged', false);
end;
$$;
revoke execute on function public.finalize_attempt(uuid, jsonb) from public, anon, authenticated;

-- Leaderboard refresh now also tells every open leaderboard screen to refetch.
create or replace function public.refresh_leaderboards()
returns void language plpgsql security definer set search_path = '' as $$
begin
  refresh materialized view concurrently public.leaderboard_all_time;
  refresh materialized view concurrently public.leaderboard_weekly;
  perform realtime.send('{}'::jsonb, 'leaderboard_refreshed', 'system', false);
end;
$$;
revoke execute on function public.refresh_leaderboards() from anon, authenticated, public;
