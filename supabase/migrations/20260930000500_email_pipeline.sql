-- ════════════════════════════════════════════════════════════════════
-- Baha Ready 3D · 0014 · Realtime email pipeline (Section 12A)
-- INSERT into email_outbox → pg_net POST to send-email (secret from Vault) → Brevo.
-- A per-minute cron retries failures with backoff.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.email_outbox_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'send_email_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'email_webhook_secret');
begin
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke execute on function public.email_outbox_dispatch() from public, anon, authenticated;

create trigger email_outbox_dispatch after insert on public.email_outbox
  for each row execute function public.email_outbox_dispatch();

create or replace function public.email_outbox_retry()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'send_email_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'email_webhook_secret');
begin
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.email_outbox where status = 'queued' and next_attempt_at <= now()) then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := '{"mode":"retry"}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
revoke execute on function public.email_outbox_retry() from public, anon, authenticated;
select cron.schedule('email-outbox-retry', '* * * * *', $$select public.email_outbox_retry()$$);

-- Housekeeping: expire report files after 7 days (job rows kept for history).
create or replace function public.expire_reports()
returns void language sql security definer set search_path = '' as $$
  update public.report_jobs set status = 'expired' where status = 'ready' and completed_at < now() - interval '7 days';
$$;
revoke execute on function public.expire_reports() from public, anon, authenticated;
select cron.schedule('expire-reports', '15 3 * * *', $$select public.expire_reports()$$);
