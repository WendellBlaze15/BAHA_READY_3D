-- Survival Phase 9: admin tooling permissions (config publish, chat hiding, scoped settings,
-- analytics). A = player, F = facilitator, M = admin, S = super admin.
select plan(13);

insert into public.survival_runs (id, host_id, mode, difficulty, config_version_id, seed, status)
values ('71717171-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'solo', 'easy',
        (select id from public.survival_config_versions where is_current), 3, 'active');
insert into public.survival_chat_messages (id, run_id, sender_id, body_original, body_delivered, status)
values (910001, '71717171-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'hello', 'hello', 'delivered');

-- Player: nothing.
select set_config('request.jwt.claims', pg_temp.claims('aaaaaaaa-0000-0000-0000-000000000001'), true);
set local role authenticated;
select throws_ok($$select public.publish_survival_config('{"x":1}', 'nope')$$, '42501', null, 'player cannot publish config');
select throws_ok($$select public.admin_hide_survival_chat(910001, null)$$, '42501', null, 'player cannot hide chat');
select throws_ok($$select public.survival_admin_analytics(30)$$, '42501', null, 'player cannot read survival analytics');
select is((select count(*) from public.system_settings where key = 'survival_chat_wordlist'), 0::bigint, 'player cannot read the filter wordlist');
reset role;

-- Facilitator: nothing either.
select set_config('request.jwt.claims', pg_temp.claims('ffffffff-0000-0000-0000-000000000003', 'aal2'), true);
set local role authenticated;
select throws_ok($$select public.survival_admin_analytics(30)$$, '42501', null, 'facilitator cannot read survival analytics');
reset role;

-- Admin: publish, hide, analytics, chat switch — but not the kill switch.
select set_config('request.jwt.claims', pg_temp.claims('dddddddd-0000-0000-0000-000000000004', 'aal2'), true);
set local role authenticated;
select ok(public.publish_survival_config((select config from public.survival_config_versions where is_current), 'test publish') > 1,
          'admin publishes a new version');
select is((select version from public.survival_config_versions where is_current), (select max(version) from public.survival_config_versions),
          'the newest version is the single current one');
select lives_ok($$select public.admin_hide_survival_chat(910001, null)$$, 'admin hides a chat message');
select ok((public.survival_admin_analytics(30) ? 'by_difficulty'), 'admin reads analytics');
update public.system_settings set value = 'false' where key = 'survival_chat_enabled';
update public.system_settings set value = 'false' where key = 'survival_enabled';
reset role;
select is((select value::text from public.system_settings where key = 'survival_chat_enabled'), 'false', 'admin can switch team chat off');
select is((select value::text from public.system_settings where key = 'survival_enabled'), 'true', 'admin cannot flip the Survival kill switch');
select ok(exists (select 1 from public.audit_logs where action = 'hide:survival_chat' and target_id = '910001'), 'hiding chat is audit-logged');

-- Super admin: kill switch.
select set_config('request.jwt.claims', pg_temp.claims('eeeeeeee-0000-0000-0000-000000000005', 'aal2'), true);
set local role authenticated;
update public.system_settings set value = 'false' where key = 'survival_enabled';
reset role;
select is((select value::text from public.system_settings where key = 'survival_enabled'), 'false', 'super admin flips the kill switch');

select * from finish();
