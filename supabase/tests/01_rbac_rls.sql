-- RBAC + RLS: every role's allowed and denied access.
-- A = player, B = player, F = facilitator, M = admin, S = super admin.
select plan(55);

-- ── Fixtures created as postgres ───────────────────────────────────────
insert into public.groups (id, facilitator_id, name, join_code)
values ('99999999-0000-0000-0000-000000000009', 'ffffffff-0000-0000-0000-000000000003', 'Test Group', 'IGNORED');
select set_config('test.code', (select join_code from public.groups where id = '99999999-0000-0000-0000-000000000009'), true);

insert into public.attempts (id, user_id, level_id, level_version_id, seed, status, score, stars, finished_at)
values ('77777777-0000-0000-0000-000000000007', 'bbbbbbbb-0000-0000-0000-000000000002', 1,
        (select current_version_id from public.levels where id = 1), 42, 'completed', 900, 2, now());

insert into public.tips (slug, title_fil, title_en, body_fil, body_en, category, is_published)
values ('draft-tip', 'Draft', 'Draft', 'x', 'x', 'before', false);

select matches(current_setting('test.code'), '^[A-Z2-9]{6}$', 'join code is generated server-side (client value ignored)');

-- ── Anonymous ──────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok((select count(*) from public.tips where slug = 'draft-tip') = 0, 'anon cannot see unpublished tips');
select ok((select count(*) from public.tips) >= 30, 'anon can read published tips');
select ok((select count(*) from public.hotlines) >= 1, 'anon can read hotlines');
select ok(exists (select 1 from public.system_settings where key = 'maintenance'), 'anon reads public setting (maintenance)');
select ok(not exists (select 1 from public.system_settings where key = 'rate_limits'), 'anon cannot read private setting (rate_limits)');
select is((select count(*) from public.profiles), 0::bigint, 'anon sees no profiles');
select is((select count(*) from public.attempts), 0::bigint, 'anon sees no attempts');
select throws_ok($$select * from public.email_outbox$$, '42501', null, 'anon cannot touch email_outbox');
reset role;

-- ── Player A ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select ok(public.authorize('levels.play_all'), 'player: levels.play_all');
select ok(public.authorize('groups.join'), 'player: groups.join');
select ok(not public.authorize('groups.manage'), 'player: no groups.manage');
select ok(not public.authorize('content.manage'), 'player: no content.manage');
select is((select count(*) from public.profiles), 1::bigint, 'player sees only own profile');
select lives_ok($$update public.profiles set display_name = 'Juan' where id = auth.uid()$$, 'player can edit own display name');
select throws_ok($$update public.profiles set status = 'active' where id = auth.uid()$$, '42501', null, 'player cannot change own status');
select is((select count(*) from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0::bigint, 'player cannot read other profiles');
select throws_ok($$insert into public.user_roles (user_id, role_id) values (auth.uid(), 4)$$, '42501', null, 'player cannot grant self admin');
select throws_ok($$insert into public.attempts (user_id, level_id, level_version_id, seed) values (auth.uid(), 1, (select current_version_id from public.levels where id = 1), 1)$$, '42501', null, 'player cannot insert attempts directly');
select is((select count(*) from public.attempts where id = '77777777-0000-0000-0000-000000000007'), 0::bigint, 'player cannot see another player''s attempt');
select throws_ok($$insert into public.tips (slug, title_fil, title_en, body_fil, body_en, category) values ('x-tip', 'x', 'x', 'x', 'x', 'before')$$, '42501', null, 'player cannot write content');
select throws_ok($$insert into public.notifications (user_id, type, title) values (auth.uid(), 'x', 'x')$$, '42501', null, 'player cannot insert notifications');
select throws_ok($$insert into public.groups (facilitator_id, name, join_code) values (auth.uid(), 'Nope', 'AAAAAA')$$, '42501', null, 'player cannot create groups');
select is((select count(*) from public.groups), 0::bigint, 'player sees no groups before joining');
select is((public.join_group(current_setting('test.code')) ->> 'status'), 'active', 'player joins group by code');
select is((select count(*) from public.groups), 1::bigint, 'member can see joined group');
select is((select count(*) from public.audit_logs), 0::bigint, 'player cannot read audit logs');
select throws_ok($$select public.join_group('ZZZZZZ')$$, 'P0002', null, 'invalid join code is NOT_FOUND');
select lives_ok($$insert into public.facilitator_applications (full_name, organization, position, contact, reason) values ('Juan Dela Cruz', 'Pila NHS', 'Teacher', '09170000000', 'Gagamitin sa klase ko.')$$, 'player can submit a facilitator application');
select throws_ok($$insert into public.facilitator_applications (full_name, organization, position, contact, reason, status) values ('Juan Dela Cruz', 'Pila NHS', 'Teacher', '09170000000', 'Gusto ko maging admin.', 'approved')$$, '42501', null, 'player cannot self-approve an application');
update public.system_settings set value = '{"enabled":true}' where key = 'maintenance';
reset role;
select is((select value->>'enabled' from public.system_settings where key = 'maintenance'), 'false', 'player cannot change system settings');
set local role authenticated;
select throws_ok($$select public.get_leaderboard('everything')$$, '22023', null, 'leaderboard rejects invalid scope');
reset role;

-- ── Player B joins as pending? (group requires approval) ───────────────
update public.groups set requires_approval = true where id = '99999999-0000-0000-0000-000000000009';
select set_config('request.jwt.claims', pg_temp.claims('bbbbbbbb-0000-0000-0000-000000000002'), true);
set local role authenticated;
select is((public.join_group(current_setting('test.code')) ->> 'status'), 'pending', 'approval-required group gives pending status');
select is((select count(*) from public.groups), 0::bigint, 'pending member cannot see group yet');
update public.group_members set status = 'active' where user_id = auth.uid();
reset role;
select is((select status from public.group_members where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 'pending', 'pending member cannot self-approve');
set local role authenticated;
reset role;

-- ── Facilitator F (aal1 then aal2) ─────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('ffffffff-0000-0000-0000-000000000003', 'aal1'), true);
set local role authenticated;
select ok(not public.authorize('groups.manage'), 'facilitator without MFA (aal1) cannot manage groups');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('ffffffff-0000-0000-0000-000000000003', 'aal2'), true);
set local role authenticated;
select ok(public.authorize('groups.manage'), 'facilitator with MFA (aal2) can manage groups');
select ok(not public.authorize('content.manage'), 'facilitator cannot manage content');
select is((select count(*) from public.group_members where group_id = '99999999-0000-0000-0000-000000000009'), 2::bigint, 'facilitator sees own group members');
select is((select count(*) from public.attempts where id = '77777777-0000-0000-0000-000000000007'), 0::bigint, 'facilitator cannot see attempts of a pending member');
select lives_ok($$update public.group_members set status = 'active' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$, 'facilitator approves join request');
select is((select count(*) from public.attempts where id = '77777777-0000-0000-0000-000000000007'), 1::bigint, 'facilitator sees attempts of active members');
select is((select count(*) from public.profiles), 3::bigint, 'facilitator sees own + members'' profiles only');
select lives_ok($$insert into public.groups (name, join_code) values ('Bagong Klase', 'AAAAAA')$$, 'facilitator creates a group');
select throws_ok($$update public.groups set facilitator_id = 'aaaaaaaa-0000-0000-0000-000000000001' where name = 'Bagong Klase'$$, '42501', null, 'facilitator cannot transfer group ownership');
reset role;

-- ── Admin M ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('dddddddd-0000-0000-0000-000000000004', 'aal1'), true);
set local role authenticated;
select ok(not public.authorize('content.manage'), 'admin without MFA cannot manage content');
reset role;

select set_config('request.jwt.claims', pg_temp.claims('dddddddd-0000-0000-0000-000000000004', 'aal2'), true);
set local role authenticated;
select ok(public.authorize('content.manage'), 'admin (aal2) can manage content');
select ok(not public.authorize('admins.manage'), 'admin cannot manage admins');
select ok(not public.authorize('system.manage'), 'admin cannot change system settings');
select ok((select count(*) from public.tips where slug = 'draft-tip') = 1, 'admin sees unpublished content');
select ok((select count(*) from public.profiles) >= 5, 'admin sees all profiles');
update public.system_settings set value = '{"enabled":true}' where key = 'maintenance';
reset role;
select is((select value->>'enabled' from public.system_settings where key = 'maintenance'), 'false', 'admin cannot toggle maintenance');
set local role authenticated;
reset role;

-- ── Super admin S ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', pg_temp.claims('eeeeeeee-0000-0000-0000-000000000005', 'aal2'), true);
set local role authenticated;
select ok(public.authorize('system.manage'), 'super admin can manage the system');
select ok(public.authorize('audit.read_all'), 'super admin reads all audit logs');
reset role;

-- ── Suspension revokes access immediately ──────────────────────────────
update public.profiles set status = 'suspended' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select ok(not public.authorize('levels.play_all'), 'suspended user loses permissions immediately');
reset role;

select * from finish();
