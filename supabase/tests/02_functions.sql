-- Functions: access token hook, leaderboard, attempt invariants, daily challenge.
select plan(12);

-- Access token hook
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', 'ffffffff-0000-0000-0000-000000000003', 'claims', '{}'::jsonb))
    -> 'claims' ->> 'user_role',
  'facilitator', 'hook injects top role');
select ok(
  (public.custom_access_token_hook(jsonb_build_object('user_id', 'ffffffff-0000-0000-0000-000000000003', 'claims', '{}'::jsonb))
    -> 'claims' -> 'permissions') ? 'groups.manage',
  'hook injects permissions');
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'claims', '{}'::jsonb))
    -> 'claims' ->> 'onboarded',
  'true', 'hook reports onboarding state');
update public.profiles set status = 'suspended' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is(
  public.custom_access_token_hook(jsonb_build_object('user_id', 'bbbbbbbb-0000-0000-0000-000000000002', 'claims', '{}'::jsonb))
    -> 'claims' -> 'permissions',
  '[]'::jsonb, 'suspended users get no permissions in JWT');
update public.profiles set status = 'active' where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- New users are bootstrapped
select is((select count(*) from public.user_settings where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1::bigint, 'new user gets settings row');
select is((select count(*) from public.player_level_progress where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and unlocked), 2::bigint, 'tutorial and level 1 unlocked by default');

-- One in-progress attempt per user
insert into public.attempts (user_id, level_id, level_version_id, seed)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1, (select current_version_id from public.levels where id = 1), 1);
select throws_ok(
  $$insert into public.attempts (user_id, level_id, level_version_id, seed)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 1, (select current_version_id from public.levels where id = 1), 2)$$,
  '23505', null, 'only one in-progress attempt per user');

-- Leaderboard: completed, unflagged attempts of visible players; staff excluded
insert into public.attempts (user_id, level_id, level_version_id, seed, status, score, stars, finished_at, flag_reasons) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 1, (select current_version_id from public.levels where id = 1), 3, 'completed', 1200, 3, now(), '{}'),
  ('dddddddd-0000-0000-0000-000000000004', 1, (select current_version_id from public.levels where id = 1), 4, 'completed', 9999, 3, now(), '{}'),
  ('ffffffff-0000-0000-0000-000000000003', 1, (select current_version_id from public.levels where id = 1), 5, 'completed', 5000, 3, now(), '{SPEED_IMPOSSIBLE}');
select public.refresh_leaderboards();

select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select is((select username from public.get_leaderboard('level', 'all_time', 1::smallint) limit 1), 'test_b', 'top of level board is the best eligible player');
select ok(not exists (select 1 from public.get_leaderboard('level', 'all_time', 1::smallint) where username = 'test_m'), 'admins are excluded from leaderboards');
select ok(not exists (select 1 from public.get_leaderboard('level', 'all_time', 1::smallint) where username = 'test_f'), 'flagged attempts are excluded');
select is((select count(*) from public.get_leaderboard('global', 'all_time', null, null, 0, 20, true)), 0::bigint, 'player without scores has no personal rank');
reset role;

-- Daily challenge exists for today
select ok(exists (select 1 from public.daily_challenges where date = (now() at time zone 'Asia/Manila')::date), 'daily challenge generated for today');

select * from finish();
