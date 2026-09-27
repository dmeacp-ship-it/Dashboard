-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 18: apply migration 17, and lock down truncate_sales_data()
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY:
-- A health check on 2026-09-28 found migration 17 had never been run in
-- Supabase: the State / City sale views it drops were still there and still
-- readable by anon and authenticated, and refresh_dashboard_views() was the
-- old version, still callable by both.
--
-- It also found a gap that neither 03 nor 17 covered. truncate_sales_data()
-- (migration 05) is SECURITY DEFINER and was executable by anon and
-- authenticated, so anyone holding the project's anon key could empty
-- sales_data with a single POST to /rest/v1/rpc/truncate_sales_data.
--
-- The browser never talks to Supabase directly; the server calls it with the
-- service role key. Nothing legitimate needs anon or authenticated access to
-- any of this.
--
-- WHAT THIS DOES (sections 1-4 in one transaction; any failure rolls it all back):
--   1. refresh_dashboard_views() refreshes whichever snapshots exist (as 17).
--   2. Drops vw_/mv_state_sale_agg and vw_/mv_city_sale_agg (as 17). Nothing
--      reads them since the State and City Sales pages were removed.
--   3. Revokes anon / authenticated on every vw_* / mv_* and the dashboard
--      tables, keeping service_role's SELECT (as 17).
--   4. Limits the dashboard RPCs -- now including truncate_sales_data() -- to
--      service_role, and pins truncate_sales_data()'s search_path.
--   5. Lists anything anon / authenticated can still reach. Expect no rows.
--
-- Supersedes 17: run this one instead. Safe to re-run.
-- HOW TO RUN: Supabase -> SQL Editor -> New query -> paste -> Run.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. refresh_dashboard_views(), driven by what actually exists ───────────
-- Listing snapshots by name meant dropping one (section 2) broke every later
-- sync on a missing relation.
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

-- ── 4. Dashboard RPCs: service_role only ───────────────────────────────────
-- A SECURITY DEFINER function runs as its owner, so a fixed search_path stops
-- a caller from steering its unqualified "sales_data" at another schema.
do $$
begin
  if to_regprocedure('public.truncate_sales_data()') is not null then
    execute 'alter function public.truncate_sales_data() set search_path = public, pg_temp';
  end if;
end $$;

-- PUBLIC has to be revoked as well: anon and authenticated inherit from it, so
-- revoking just those two leaves the inherited grant in place (migration 03).
-- Granting service_role first keeps the server working throughout.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'refresh_dashboard_views',
        'truncate_sales_data',
        'get_filter_options',
        'api_top_skus',
        'api_size_agg',
        'get_enterprise_kpis',
        'get_db_row_count'
      )
  loop
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon, authenticated', f.sig);
  end loop;
end $$;

commit;

-- ── 5. Check: this should return NO ROWS ──────────────────────────────────
-- Tables count only when row-level security wouldn't stop the read. Extension
-- internals (pg_trgm) and trigger functions are left out: the first expose no
-- data and the second can't be called directly.
select 'table/view' as kind, c.relname::text as name, g.role as grantee
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) g(role)
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
  and has_table_privilege(g.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and (c.relkind in ('v', 'm')
       or not c.relrowsecurity
       or exists (select 1 from pg_policies pol
                  where pol.schemaname = 'public' and pol.tablename = c.relname
                    and pol.roles && array['public', g.role]::name[]))
union all
select 'function', p.oid::regprocedure::text, g.role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated')) g(role)
where n.nspname = 'public'
  and p.prorettype <> 'trigger'::regtype
  and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')
  and has_function_privilege(g.role, p.oid, 'EXECUTE')
order by 1, 2, 3;
