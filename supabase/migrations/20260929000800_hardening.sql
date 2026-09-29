-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0008 · Advisor hardening
-- ════════════════════════════════════════════════════════════════════

-- Trigger functions must never be callable through the API.
revoke execute on function
  public.audit_trigger(),
  public.group_members_track_decision(),
  public.groups_assign_code(),
  public.live_sessions_assign_code(),
  public.handle_new_profile_streak(),
  public.handle_new_user(),
  public.set_updated_at()
from public, anon, authenticated;

-- Helpers used inside RLS: signed-in users only.
revoke execute on function public.realtime_topic_id(text), public.current_request_ip() from public, anon;

-- Replace the definer-rights view with a narrow RPC (safe columns, bounded input).
drop view if exists public.public_profiles;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (id uuid, username text, avatar_key text, avatar_config jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username::text, p.avatar_key, p.avatar_config
  from public.profiles p
  where p.id = any (p_ids[1:100]) and p.status = 'active';
$$;
revoke execute on function public.get_public_profiles(uuid[]) from public, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;

-- Username availability check for onboarding (no enumeration of other columns).
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_username ~ '^[a-zA-Z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where username = p_username::extensions.citext
                     and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
$$;
revoke execute on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;
