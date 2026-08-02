-- ============================================================================
--  FILE 1 of 4  —  RUN THIS FIRST
--
--  This changes NOTHING. It only shows you what the public (logged-out) key
--  can currently reach in your database. Run it, then save/screenshot the
--  output so you can compare after the fix.
--
--  Where: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================================


-- ── Query A: which TABLES and VIEWS can the public key read? ────────────────
-- Anything listed here with grantee = 'anon' is readable by anyone on the
-- internet who has your project URL and anon key, with no login.

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by grantee, table_name, privilege_type;


-- ── Query B: which FUNCTIONS can the public key run? ────────────────────────
-- You will see ~30 rows named gtrgm_*, gin_trgm_*, similarity*,
-- word_similarity*, show_trgm, set_limit, show_limit.
-- THOSE ARE NORMAL. They are text-search extension internals, they expose no
-- data, and file 2 deliberately leaves them alone.
--
-- The ones that matter are: refresh_dashboard_views, api_top_skus,
-- api_size_agg, get_filter_options, get_enterprise_kpis, get_db_row_count.

select p.proname as function_name, a.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select rolname from pg_roles where rolname in ('anon','authenticated')) a
where n.nspname = 'public'
  and has_function_privilege(a.rolname, p.oid, 'execute')
order by grantee, function_name;


-- ============================================================================
--  Done. Now do 02_switch_to_service_role_key.md
-- ============================================================================
