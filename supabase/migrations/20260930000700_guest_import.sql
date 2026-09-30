-- Guest progress import fix.
-- guest-migrate inserts each re-validated guest run as an in_progress attempt and finalizes it.
-- The "one in-progress attempt per user" index (meant to stop parallel live play) made those
-- inserts fail whenever the player had a game open, and the runs were silently dropped.
-- Imported attempts are now flagged and excluded from that rule.

alter table public.attempts add column if not exists imported boolean not null default false;

drop index if exists public.attempts_one_in_progress_idx;
create unique index attempts_one_in_progress_idx on public.attempts (user_id)
  where status = 'in_progress' and not imported;

comment on column public.attempts.imported is
  'True for guest (local) runs imported after sign-up by guest-migrate; re-validated server-side.';
