-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 13: Login activity log
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates `dashboard_login_logs` (one row per sign-in event) and
-- `vw_login_summary` (one row per username: last login, last seen and recent
-- counts). They back Settings -> Login Activity, which shows who is using the
-- dashboard and who is not.
--
-- EVENTS (written by the dashboard server, src/services/loginlog.service.js):
--   login          signed in with username + password
--   login_failed   a sign-in was refused; `detail` says why (wrong password,
--                  unknown username, account disabled)
--   logout         clicked Sign Out
--   session        opened the dashboard while still signed in. A sign-in lasts
--                  12 hours, so without this someone who reopens the dashboard
--                  later the same day would look inactive. Written at most once
--                  per 30 minutes per user, so page refreshes don't flood it.
--
-- ACCESS:
-- Same as dashboard_users: only the dashboard server reads or writes it, with
-- the service role key. RLS is off and anon / authenticated get no access.
--
-- RETENTION:
-- Rows are kept indefinitely. To trim later, for example:
--   delete from public.dashboard_login_logs where created_at < now() - interval '1 year';
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.dashboard_login_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  username    text not null,  -- the account's username, or what was typed on a failed sign-in
  user_id     text,           -- dashboard_users.id; null when no account matched
  full_name   text,
  role        text,
  event       text not null,  -- login | login_failed | logout | session
  detail      text,           -- why a sign-in failed
  ip          text,
  user_agent  text
);

create index if not exists dashboard_login_logs_created_at_idx
  on public.dashboard_login_logs (created_at desc);
create index if not exists dashboard_login_logs_username_idx
  on public.dashboard_login_logs (username, created_at desc);

alter table public.dashboard_login_logs disable row level security;
revoke all on public.dashboard_login_logs from anon, authenticated;
grant select, insert on public.dashboard_login_logs to service_role;

-- One row per username that appears in the log. Accounts that never signed in
-- have no row here; the server lists every account from dashboard_users and
-- fills those in as "never".
create or replace view public.vw_login_summary as
select
  username,
  max(created_at) filter (where event = 'login')                    as last_login,
  max(created_at) filter (where event in ('login', 'session'))      as last_seen,
  count(*) filter (where event = 'login'
                   and created_at >= now() - interval '7 days')     as logins_7d,
  count(*) filter (where event = 'login'
                   and created_at >= now() - interval '30 days')    as logins_30d,
  -- distinct calendar days (India time) with any use in the last 30 days
  count(distinct (created_at at time zone 'Asia/Kolkata')::date)
        filter (where event in ('login', 'session')
                and created_at >= now() - interval '30 days')       as active_days_30d,
  count(*) filter (where event = 'login_failed'
                   and created_at >= now() - interval '7 days')     as failed_7d,
  max(created_at) filter (where event = 'login_failed')             as last_failed
from public.dashboard_login_logs
group by username;

revoke all on public.vw_login_summary from anon, authenticated;
grant select on public.vw_login_summary to service_role;
