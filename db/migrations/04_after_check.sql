-- ============================================================================
--  FILE 4 of 4  —  RUN THIS LAST
--
--  This changes NOTHING. It confirms the fix worked.
--  Run it and compare against what file 1 showed you.
--
--  Where: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================================


-- ── Check 1: PASS or FAIL, in one row ───────────────────────────────────────
-- This is the one that matters. It should say PASS.

select
  case when count(*) = 0
       then 'PASS — no sales/customer data is publicly readable'
       else 'FAIL — ' || count(*) || ' grant(s) still exposed: ' ||
            string_agg(distinct table_name, ', ')
  end as result
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and (
    table_name like 'mv\_%' or
    table_name like 'vw\_%' or
    table_name in ('sales_data','outstanding_master','target_master',
                   'dashboard_users','user_profiles','app_settings')
  );


-- ── Check 2: the app functions should be gone ───────────────────────────────
-- Expect: "PASS". If any are listed, re-run file 3.

select
  case when count(*) = 0
       then 'PASS — no dashboard functions are publicly callable'
       else 'FAIL — still callable: ' || string_agg(distinct p.proname, ', ')
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select rolname from pg_roles where rolname in ('anon','authenticated')) a
where n.nspname = 'public'
  and p.proname in ('refresh_dashboard_views','api_top_skus','api_size_agg',
                    'get_filter_options','get_enterprise_kpis','get_db_row_count')
  and has_function_privilege(a.rolname, p.oid, 'execute');


-- ── Check 3: full listing, for your records ─────────────────────────────────
-- Anything still here should be pg_trgm text-search internals only
-- (gtrgm_*, gin_trgm_*, similarity*, word_similarity*, show_trgm,
-- set_limit, show_limit). Those are expected and harmless.

select p.proname as still_callable_by_public, a.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select rolname from pg_roles where rolname in ('anon','authenticated')) a
where n.nspname = 'public'
  and has_function_privilege(a.rolname, p.oid, 'execute')
order by grantee, p.proname;


-- ============================================================================
--  If Check 1 and Check 2 both say PASS, you are done.
-- ============================================================================
