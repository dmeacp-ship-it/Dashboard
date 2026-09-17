-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 17: close the public access that migrations 14 and 15 reopened
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY:
-- Migration 03 removed every privilege the anon / authenticated roles had on
-- dashboard data. The browser never talks to Supabase directly -- it calls
-- /api, which uses the service role key -- so nothing legitimate needs those
-- grants. Migrations 14 and 15 then granted SELECT on the customer, state and
-- city sale views back to anon, and EXECUTE on refresh_dashboard_views() too.
-- As it stands, anyone with the project URL and the anon key can read every
-- customer, revenue and outstanding figure in those views, and can force a
-- rebuild of every snapshot repeatedly.
--
-- WHAT THIS DOES:
--   1. Rewrites refresh_dashboard_views() to refresh whatever materialized
--      views exist, so dropping one can never break the sync again.
--   2. Drops vw_state_sale_agg / vw_city_sale_agg and their snapshots. The
--      State Sales and City Sales pages are gone, so nothing reads them.
--      Skip section 2 if you would rather keep them.
--   3. Re-runs migration 03's sweep: revoke anon / authenticated on every
--      vw_* and mv_* in public, so anything added since is covered too.
--   4. Locks refresh_dashboard_views() back down.
--   5. Prints what anon can still reach. It should return no rows.
--
-- SAFETY:
-- Sections 1-4 run in one transaction: if any statement fails, the whole thing
-- rolls back. The dashboard is unaffected either way, since the server holds
-- the service role key.
--
-- HOW TO RUN:
-- Supabase -> SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. refresh_dashboard_views(), driven by what actually exists ───────────
-- The old version listed each snapshot by name, so dropping one (section 2)
-- would make every later sync fail on a missing relation.
create or replace function public.refresh_dashboard_views()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v record;
begin
  for v in
    select matviewname from pg_matviews where schemaname = 'public' order by matviewname
  loop
    execute format('refresh materialized view public.%I', v.matviewname);
  end loop;
end;
$$;

-- ── 2. Drop the unused State / City sale views ─────────────────────────────
-- Snapshots first: they depend on the views.
drop materialized view if exists public.mv_state_sale_agg;
drop materialized view if exists public.mv_city_sale_agg;
drop view if exists public.vw_state_sale_agg;
drop view if exists public.vw_city_sale_agg;

-- ── 3. Revoke anon / authenticated on every dashboard view and table ───────
do $$
declare r record;
begin
  for r in
    select table_name as rel from information_schema.views
      where table_schema = 'public' and table_name like 'vw\_%'
    union all
    select matviewname as rel from pg_matviews where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon, authenticated', r.rel);
    -- make sure the backend keeps its own access in its own right
    execute format('grant select on public.%I to service_role', r.rel);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'sales_data', 'outstanding_master', 'target_master',
    'dashboard_users', 'dashboard_login_logs', 'app_settings', 'user_profiles'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── 4. refresh_dashboard_views(): service role only ───────────────────────
-- PUBLIC has to be revoked as well. anon and authenticated inherit from it, so
-- revoking just those two leaves the inherited grant in place (see migration
-- 03). Granting service_role first keeps the backend working throughout.
grant execute on function public.refresh_dashboard_views() to service_role;
revoke execute on function public.refresh_dashboard_views() from public;
revoke execute on function public.refresh_dashboard_views() from anon, authenticated;

commit;

-- ── 5. Check: this should return NO ROWS ──────────────────────────────────
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and (table_name like 'vw\_%'
       or table_name like 'mv\_%'
       or table_name in ('sales_data', 'outstanding_master', 'target_master',
                         'dashboard_users', 'dashboard_login_logs'))
order by table_name, grantee;
