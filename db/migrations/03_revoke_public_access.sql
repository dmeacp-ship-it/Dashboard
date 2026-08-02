-- ============================================================================
--  FILE 3 of 4  —  RUN THIS THIRD         *** THIS IS THE ACTUAL FIX ***
--
--  ┌──────────────────────────────────────────────────────────────────────┐
--  │ STOP. PREREQUISITE.                                                  │
--  │                                                                      │
--  │ Complete 02_switch_to_service_role_key.md FIRST.                     │
--  │                                                                      │
--  │ This script removes database access from the `anon` role. If your    │
--  │ backend is still connecting with the anon key, running this will     │
--  │ break every query in the dashboard.                                  │
--  │                                                                      │
--  │ Verify with:   node tools/check-supabase-key.js                      │
--  │ It must print: RESULT: SAFE.                                         │
--  └──────────────────────────────────────────────────────────────────────┘
--
--  WHAT IT DOES
--  Removes read access to your sales/customer data for the public `anon` role,
--  the `authenticated` role, and the catch-all PUBLIC pseudo-role.
--
--  WHY IT IS SAFE ONCE THE PREREQUISITE IS DONE
--  Nothing below touches service_role — in fact section 4 explicitly grants to
--  it before revoking from everyone else. The browser never talks to Supabase
--  directly; it only calls /api. So the dashboard is unaffected.
--
--  WHY IT MATTERS
--  Materialized views (mv_*) cannot have row-level security. With SELECT
--  granted to `anon`, anyone with your project URL and anon key could read
--  every customer, revenue figure and outstanding balance without logging in.
--
--  SAFETY
--  Everything runs inside one transaction. If any statement fails, the whole
--  thing rolls back and your database is left exactly as it was.
--
--  Where: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================================

begin;

-- ── 1. Materialized views ───────────────────────────────────────────────────
-- These are the critical ones: Postgres cannot apply row-level security to a
-- materialized view, so a grant here is a straight public data dump.
-- Looped by name so a view that doesn't exist in your project is skipped
-- instead of aborting the script.
do $$
declare v text;
begin
  foreach v in array array[
    'mv_monthly_agg', 'mv_hod_agg', 'mv_customer_sale_agg', 'mv_sku_type_sale_agg',
    'mv_brand_agg', 'mv_sku_agg', 'mv_filter_options', 'mv_customer_summary',
    'mv_sku_meta'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
      raise notice 'revoked: %', v;
    end if;
  end loop;
end $$;


-- ── 2. Plain views (every vw_* the dashboard reads) ─────────────────────────
do $$
declare v record;
begin
  for v in
    select table_name from information_schema.views
    where table_schema = 'public' and table_name like 'vw\_%'
  loop
    execute format('revoke all on public.%I from anon, authenticated', v.table_name);
    raise notice 'revoked: %', v.table_name;
  end loop;
end $$;


-- ── 3. Base tables ──────────────────────────────────────────────────────────
-- Raw sales rows, outstanding balances, targets, and the login accounts table.
do $$
declare t text;
begin
  foreach t in array array[
    'sales_data', 'outstanding_master', 'target_master',
    'dashboard_users', 'user_profiles', 'app_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
      raise notice 'revoked: %', t;
    end if;
  end loop;
end $$;


-- ── 4. Functions (RPCs) ─────────────────────────────────────────────────────
-- refresh_dashboard_views was the denial-of-service vector: anyone could force
-- a rebuild of every materialized view, repeatedly. api_* and
-- get_enterprise_kpis return the same aggregates as the views.
-- get_db_row_count leaks table sizes.
--
-- IMPORTANT — why revoking from `anon` alone is not enough:
-- Postgres grants EXECUTE on every newly created function to the catch-all
-- pseudo-role PUBLIC, automatically. `anon` and `authenticated` inherit from
-- PUBLIC. So `revoke ... from anon` removes only the explicit grant and leaves
-- the inherited one — has_function_privilege('anon', ...) still returns true.
-- We must revoke from PUBLIC as well.
--
-- And why the GRANT comes first:
-- revoking from PUBLIC also removes service_role's inherited access. Some of
-- these functions were explicitly granted to service_role by the earlier perf
-- migrations, but not all — and get_filter_options is called on every dashboard
-- load. Granting to service_role before revoking guarantees the backend keeps
-- working no matter which case each function is in.
--
-- Safe to re-run: grant-then-revoke is idempotent.
--
-- NOT TOUCHED, ON PURPOSE: gtrgm_*, gin_trgm_*, similarity*, word_similarity*,
-- show_trgm, set_limit, show_limit. Those are pg_trgm extension internals,
-- granted to PUBLIC when the extension is installed. They only operate on
-- values the caller passes in, expose no table data, and revoking them can
-- break trigram indexes and any view that calls similarity(). They will still
-- appear in the file-3 listing. That is expected.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'refresh_dashboard_views',
        'api_top_skus',
        'api_size_agg',
        'get_filter_options',
        'get_enterprise_kpis',
        'get_db_row_count',
        '_set_updated_at'
      )
  loop
    -- 1. make sure the backend's own role has access in its own right
    execute format('grant execute on function %s to service_role', f.sig);
    -- 2. now remove it from everyone else, including the inherited PUBLIC grant
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon, authenticated', f.sig);
    raise notice 'locked down function: %', f.sig;
  end loop;
end $$;


-- ── 5. Stop this from coming back ───────────────────────────────────────────
-- Without this, objects you create later get auto-granted again — functions in
-- particular are granted to PUBLIC on creation by default, which is exactly how
-- the RPCs above ended up publicly callable in the first place.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

commit;


-- ============================================================================
--  Done. Now:
--    1. Open your dashboard, sign in, click Overview / Customers / Targets.
--       It should behave exactly as before.
--    2. Run 04_after_check.sql to confirm the access is gone.
-- ============================================================================
