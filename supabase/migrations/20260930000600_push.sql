-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0015 · Push notifications: every new in-app notification is also pushed
-- (web push via the Next.js dispatcher; the user's push preference is checked there).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.notifications_push_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'email_webhook_secret');
begin
  if v_url is null or v_secret is null then return new; end if;
  -- Only users who registered a device get a call (cheap no-op otherwise).
  if not exists (select 1 from public.user_devices where user_id = new.user_id) then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke execute on function public.notifications_push_dispatch() from public, anon, authenticated;

create trigger notifications_push after insert on public.notifications
  for each row execute function public.notifications_push_dispatch();
