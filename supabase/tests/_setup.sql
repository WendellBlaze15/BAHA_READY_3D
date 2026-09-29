-- Shared test fixtures (prepended to every test file; everything is rolled back).
-- Users: player A, player B, facilitator F, admin M, super admin S.
set search_path = public, extensions;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '{}', '{}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '{}', '{}', now(), now()),
  ('ffffffff-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@test.local', '{}', '{}', now(), now()),
  ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm@test.local', '{}', '{}', now(), now()),
  ('eeeeeeee-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's@test.local', '{}', '{}', now(), now());

update public.profiles set username = 'test_a', consent_at = now(), onboarded_at = now(), barangay = 'Bagong Pook'
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set username = 'test_b', consent_at = now(), onboarded_at = now(), barangay = 'Bagong Pook'
  where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set username = 'test_f', consent_at = now(), onboarded_at = now()
  where id = 'ffffffff-0000-0000-0000-000000000003';
update public.profiles set username = 'test_m', consent_at = now(), onboarded_at = now()
  where id = 'dddddddd-0000-0000-0000-000000000004';
update public.profiles set username = 'test_s', consent_at = now(), onboarded_at = now()
  where id = 'eeeeeeee-0000-0000-0000-000000000005';

insert into public.user_roles (user_id, role_id) values
  ('ffffffff-0000-0000-0000-000000000003', 3),
  ('dddddddd-0000-0000-0000-000000000004', 4),
  ('eeeeeeee-0000-0000-0000-000000000005', 5);
delete from public.user_roles where role_id = 2 and user_id in
  ('dddddddd-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000005');

-- Helper: become a user (aal1 or aal2) or anon, within the current transaction.
create or replace function pg_temp.claims(uid uuid, aal text default 'aal1')
returns text language sql immutable as $$
  select json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text
$$;
