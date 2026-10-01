-- Survival Phase 7: finishing a run (results, stats, rewards, achievements, tips), idempotency,
-- server-only access, resume notifications.
select plan(14);

insert into public.survival_runs (id, host_id, mode, difficulty, config_version_id, seed, status)
values ('61616161-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'coop', 'normal',
        (select id from public.survival_config_versions where is_current), 7, 'active');
insert into public.survival_run_members (run_id, user_id, role) values
  ('61616161-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'medic'),
  ('61616161-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'builder');
-- A published tip unlocked by the live-wire mistake.
insert into public.tips (slug, title_fil, title_en, body_fil, body_en, category, unlock_rule, is_published)
values ('qa-live-wire-survival', 't', 't', 'b', 'b', 'electricity', '{"type":"mistake","key":"live_wire"}', true)
on conflict (slug) do nothing;

-- Players cannot call it.
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select throws_ok($$select public.finish_survival_run('61616161-0000-0000-0000-000000000001', '{}')$$, '42501', null,
  'players cannot finish runs (server only)');
select throws_ok($$select public.notify_survival_resumed('61616161-0000-0000-0000-000000000001', auth.uid(), 3, 'ABCDEF')$$, '42501', null,
  'players cannot send resume notices');
reset role;

select lives_ok($$select public.finish_survival_run('61616161-0000-0000-0000-000000000001', '{
  "ending":"full_rescue","days_survived":30,"final_score":12345,"base_score":8000,"team_size":2,
  "real_minutes":240,"boat_stage":6,"learning_summary":{"drank_boiled_water":{"good":3,"bad":0}},
  "all_npcs_rescued":true,"team_deaths":0,"total_days":30,
  "players":{
    "aaaaaaaa-0000-0000-0000-000000000001":{"rescued":true,"survived":true,"deaths":0,"revives_given":2,
      "boat_stages_built":3,"nights_survived":29,"drank_unsafe":false,"tip_keys":["live_wire"]},
    "bbbbbbbb-0000-0000-0000-000000000002":{"rescued":true,"survived":true,"deaths":1,"revives_given":0,
      "boat_stages_built":3,"nights_survived":29,"drank_unsafe":true,"tip_keys":[]},
    "dddddddd-0000-0000-0000-000000000004":{"rescued":true,"survived":true}
  }}'::jsonb)$$, 'finish_survival_run succeeds');

select is((select status from public.survival_runs where id = '61616161-0000-0000-0000-000000000001'), 'completed', 'run marked completed');
select is((select final_score from public.survival_results where run_id = '61616161-0000-0000-0000-000000000001'), 12345, 'result stored');
select is((select runs_completed from public.survival_player_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1, 'player totals updated');
select ok(exists (select 1 from public.player_cosmetics where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and item_key = 'vest_rescue_orange'),
  'rescue vest rewarded');
select ok(exists (select 1 from public.player_cosmetics where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and item_key = 'cap_heli_pilot'),
  'pilot cap for full rescue on Normal');
select ok(not exists (select 1 from public.player_cosmetics where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and item_key = 'paddle_golden'),
  'no golden paddle (Hard only)');
select ok(exists (select 1 from public.player_achievements pa join public.achievements a on a.id = pa.achievement_id
                  where pa.user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and a.key = 'survival_malinis_na_tubig')
          and not exists (select 1 from public.player_achievements pa join public.achievements a on a.id = pa.achievement_id
                  where pa.user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and a.key = 'survival_malinis_na_tubig'),
  'clean-water achievement only for the player who never drank unsafe water');
select ok(exists (select 1 from public.player_tips pt join public.tips t on t.id = pt.tip_id
                  where pt.user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and t.slug = 'qa-live-wire-survival'),
  'lesson tip unlocked');
select ok(not exists (select 1 from public.survival_player_stats where user_id = 'dddddddd-0000-0000-0000-000000000004'),
  'non-members get no credit');
select is((public.finish_survival_run('61616161-0000-0000-0000-000000000001', '{"ending":"failed"}') ->> 'already'), 'true',
  'finishing twice is a no-op');

select public.notify_survival_resumed('61616161-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 12, 'ABCDEF');
select ok(exists (select 1 from public.notifications where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and type = 'survival_resumed'),
  'teammates notified when a run is resumed');

select * from finish();
