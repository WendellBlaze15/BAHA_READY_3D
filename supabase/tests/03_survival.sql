-- Survival Mode: eligibility, RLS per role, server-only tables, audited evidence, jobs.
-- A = player, B = player, F = facilitator (keeps the player role), M = admin, S = super admin.
select plan(51);

-- ── Fixtures (as postgres) ─────────────────────────────────────────────
insert into public.survival_runs (id, host_id, mode, difficulty, config_version_id, seed, status)
values ('51515151-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'coop', 'normal',
        (select id from public.survival_config_versions where is_current), 42, 'active');
insert into public.survival_run_members (run_id, user_id, role) values
  ('51515151-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'medic'),
  ('51515151-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000003', 'builder');
insert into public.survival_sessions (id, run_id, room_id)
values ('52525252-0000-0000-0000-000000000002', '51515151-0000-0000-0000-000000000001', 'room1');
insert into public.survival_snapshots (run_id, day, time_of_day, state, byte_size)
values ('51515151-0000-0000-0000-000000000001', 1, 300, '{"x":1}', 7);
insert into public.survival_chat_messages (id, run_id, session_id, sender_id, body_original, body_delivered, status)
values (900001, '51515151-0000-0000-0000-000000000001', '52525252-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000002', 'add mo ko sa fb', null, 'rejected');
insert into public.survival_reports (id, run_id, reporter_id, reported_id, reason, priority, message_id, evidence)
values ('53535353-0000-0000-0000-000000000003', '51515151-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'personal_info_request', 'high', 900001, '{"message_ids":[900001]}');
insert into public.survival_learning_events (run_id, user_id, day, event_key, is_positive) values
  ('51515151-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'drank_boiled_water', true),
  ('51515151-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000003', 1, 'wore_boots', true);
insert into public.survival_blocks (blocker_id, blocked_id)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ── Eligibility (Section 2.2) ──────────────────────────────────────────
select ok(public.can_play_survival('aaaaaaaa-0000-0000-0000-000000000001'), 'player A can play');
select ok(not public.can_play_survival('ffffffff-0000-0000-0000-000000000003'), 'facilitator cannot play (even with the player role)');
select ok(not public.can_play_survival('dddddddd-0000-0000-0000-000000000004'), 'admin cannot play');
select ok(not public.can_play_survival('eeeeeeee-0000-0000-0000-000000000005'), 'super admin cannot play');
select ok(not public.can_play_survival(null), 'guest (no user) cannot play');
update public.profiles set status = 'suspended' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select ok(not public.can_play_survival('bbbbbbbb-0000-0000-0000-000000000002'), 'suspended player cannot play');
update public.profiles set status = 'active' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.survival_restrictions (user_id, scope, reason, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'survival', 'test restriction', 'eeeeeeee-0000-0000-0000-000000000005');
select ok(not public.can_play_survival('bbbbbbbb-0000-0000-0000-000000000002'), 'survival-restricted player cannot play');
select is((public.custom_access_token_hook(jsonb_build_object('user_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'claims', '{}'::jsonb))
           -> 'claims' ->> 'can_play_survival'), 'true', 'token hook adds can_play_survival=true for players');
select is((public.custom_access_token_hook(jsonb_build_object('user_id', 'ffffffff-0000-0000-0000-000000000003', 'claims', '{}'::jsonb))
           -> 'claims' ->> 'can_play_survival'), 'false', 'token hook adds can_play_survival=false for facilitators');

-- ── Anonymous ──────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.survival_runs$$, '42501', null, 'anon: no runs');
select throws_ok($$select * from public.survival_config_versions$$, '42501', null, 'anon: no config');
select is((select count(*) from public.cosmetic_items), 6::bigint, 'anon can browse the reward catalog');
reset role;

-- ── Player A (member) ──────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select is((select count(*) from public.survival_runs), 1::bigint, 'member sees their run');
select is((select count(*) from public.survival_run_members), 2::bigint, 'member sees teammates');
select is((select count(*) from public.survival_config_versions), 1::bigint, 'eligible player reads the current config');
select is((select count(*) from public.survival_learning_events), 1::bigint, 'player sees only own learning events');
select is((select count(*) from public.list_my_survival_runs()), 1::bigint, 'list_my_survival_runs returns my run');
select lives_ok($$select * from public.get_survival_leaderboard('normal', 'team', 'all_time')$$, 'player can view the leaderboard');
select throws_ok($$select * from public.survival_snapshots$$, '42501', null, 'snapshots are server-only');
select throws_ok($$select * from public.survival_chat_messages$$, '42501', null, 'chat log is not readable by players');
select throws_ok($$insert into public.survival_runs (host_id, mode, difficulty, config_version_id, seed) values (auth.uid(), 'solo', 'easy', (select id from public.survival_config_versions limit 1), 1)$$, '42501', null, 'players cannot create runs directly');
select throws_ok($$insert into public.survival_config_versions (version, config) values (99, '{}')$$, '42501', null, 'players cannot publish config');
select throws_ok($$insert into public.survival_reports (reporter_id, reported_id, reason) values (auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'other')$$, '42501', null, 'reports only via the server (evidence is server-made)');
select throws_ok($$select * from public.get_report_chat_evidence('53535353-0000-0000-0000-000000000003')$$, '42501', null, 'players cannot read chat evidence');
select is((select count(*) from public.survival_reports), 1::bigint, 'reporter sees own report status');
select lives_ok($$insert into public.survival_blocks (blocker_id, blocked_id) values (auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002')$$, 'player can block');
select is((select count(*) from public.survival_blocks), 1::bigint, 'player sees only own blocks');
select throws_ok($$update public.profiles set avatar_config = jsonb_set(avatar_config, '{hat}', '"cap_heli_pilot"') where id = auth.uid()$$, '42501', null, 'locked reward cosmetic cannot be equipped');
reset role;
insert into public.player_cosmetics (user_id, item_key) values ('aaaaaaaa-0000-0000-0000-000000000001', 'cap_heli_pilot');
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select lives_ok($$update public.profiles set avatar_config = jsonb_set(avatar_config, '{hat}', '"cap_heli_pilot"') where id = auth.uid()$$, 'owned reward cosmetic can be equipped');
reset role;

-- ── Player B (not a member, restricted) ────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('bbbbbbbb-0000-0000-0000-000000000002'), true);
set local role authenticated;
select is((select count(*) from public.survival_runs), 0::bigint, 'non-member sees no runs');
select is((select count(*) from public.survival_config_versions), 0::bigint, 'restricted player cannot read config');
select is((select count(*) from public.survival_restrictions), 1::bigint, 'restricted player still sees why (own restriction)');
reset role;

-- ── Facilitator F (even as a past member) ──────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('ffffffff-0000-0000-0000-000000000003', 'aal2'), true);
set local role authenticated;
select is((select count(*) from public.survival_runs), 0::bigint, 'facilitator sees no runs (even their own)');
select is((select count(*) from public.survival_run_members), 0::bigint, 'facilitator sees no members');
select is((select count(*) from public.survival_config_versions), 0::bigint, 'facilitator cannot read config');
select is((select count(*) from public.survival_learning_events), 0::bigint, 'facilitator sees no learning events');
select throws_ok($$insert into public.survival_blocks (blocker_id, blocked_id) values (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001')$$, '42501', null, 'facilitator cannot use survival blocks');
select ok(not public.authorize('survival.rooms.monitor'), 'facilitator cannot monitor rooms');
reset role;

-- ── Admin M ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('dddddddd-0000-0000-0000-000000000004', 'aal1'), true);
set local role authenticated;
select is((select count(*) from public.survival_runs), 0::bigint, 'admin without MFA (aal1) sees nothing');
reset role;
-- Total as the table owner (the live DB may hold real runs too).
select set_config('t.all_runs', (select count(*) from public.survival_runs)::text, true);
select set_config('request.jwt.claims', pg_temp.claims('dddddddd-0000-0000-0000-000000000004', 'aal2'), true);
set local role authenticated;
select is((select count(*) from public.survival_runs), current_setting('t.all_runs')::bigint, 'admin (aal2) monitors all runs');
select is((select count(*) from public.survival_reports where priority = 'high'), 1::bigint, 'admin sees the high-priority report queue');
select is((select count(*) from public.get_report_chat_evidence('53535353-0000-0000-0000-000000000003')), 1::bigint, 'admin reads chat evidence through the report');
select throws_ok($$select * from public.survival_chat_messages$$, '42501', null, 'admin cannot browse all chats directly');
select lives_ok($$insert into public.survival_restrictions (user_id, scope, reason, created_by) values ('bbbbbbbb-0000-0000-0000-000000000002', 'chat', 'asked for contact info', auth.uid())$$, 'admin applies a chat restriction');
select ok(not public.authorize('survival.rooms.force_close'), 'admin cannot force-close rooms');
reset role;
select ok(exists (select 1 from public.audit_logs where action = 'view:survival_chat_evidence'
                  and target_id = '53535353-0000-0000-0000-000000000003'), 'chat-evidence view was audit-logged');

-- ── Super admin S ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('eeeeeeee-0000-0000-0000-000000000005', 'aal2'), true);
set local role authenticated;
select ok(public.authorize('survival.rooms.force_close') and public.authorize('survival.system.toggle'), 'super admin can force-close and toggle');
reset role;

-- ── Jobs ───────────────────────────────────────────────────────────────
insert into public.survival_snapshots (run_id, day, time_of_day, state, byte_size)
select '51515151-0000-0000-0000-000000000001', d, 300, '{}', 2 from generate_series(2, 8) d;
select is((select count(*) from public.survival_snapshots where run_id = '51515151-0000-0000-0000-000000000001'), 5::bigint, 'only the latest 5 snapshots are kept');
insert into public.survival_chat_messages (id, run_id, sender_id, body_original, status, created_at) values
  (900002, '51515151-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'old', 'delivered', now() - interval '20 days');
update public.survival_chat_messages set created_at = now() - interval '20 days' where id = 900001;
select lives_ok($$select public.survival_maintenance()$$, 'maintenance job runs');
select ok(not exists (select 1 from public.survival_chat_messages where id = 900002), 'chat older than 14 days is purged');
select ok(exists (select 1 from public.survival_chat_messages where id = 900001), 'messages attached to an open report are kept');

select * from finish();
