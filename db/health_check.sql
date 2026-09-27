-- ═══════════════════════════════════════════════════════════════════════════
--  Virgo ACP Dashboard — Supabase health check
--  Read-only: changes nothing. Supabase → SQL Editor → New query → paste → Run.
--  One row per check. Fix FAIL rows first, then WARN. INFO is for reference.
--  After changing the database, re-run it; everything should be PASS or INFO.
-- ═══════════════════════════════════════════════════════════════════════════
with
-- What the server reads. A missing one breaks a page.
req(rel) as (values
  ('sales_data'), ('outstanding_master'), ('target_master'),
  ('dashboard_users'), ('dashboard_login_logs'), ('app_settings'),
  ('vw_monthly_agg'), ('vw_hod_agg'), ('vw_customer_sale_agg'), ('vw_customer_summary'),
  ('vw_sku_type_sale_agg'), ('vw_sku_agg'), ('vw_brand_agg'), ('vw_sales_type_agg'),
  ('vw_executive_sale_agg'), ('vw_project_sale_agg'), ('vw_outstanding_hod'),
  ('vw_filter_options'), ('vw_login_summary')
),
-- The server falls back when these are missing; the feature degrades.
opt(rel) as (values
  ('vw_hod_state'), ('vw_executive_city_agg'), ('vw_customer_kpi_counts'), ('vw_filter_options_distinct')
),
-- Materialized snapshots. Preferred by the server; without one it reads the slower live view.
snap(rel) as (values
  ('mv_monthly_agg'), ('mv_hod_agg'), ('mv_customer_sale_agg'), ('mv_customer_summary'),
  ('mv_sku_type_sale_agg'), ('mv_sku_agg'), ('mv_sku_meta'), ('mv_brand_agg'),
  ('mv_filter_options'), ('mv_sales_type_agg')
),
-- Removed by migration 17 (the State / City Sales pages are gone).
dropped(rel) as (values
  ('vw_state_sale_agg'), ('vw_city_sale_agg'), ('mv_state_sale_agg'), ('mv_city_sale_agg')
),
fn(name) as (values ('refresh_dashboard_views'), ('truncate_sales_data')),

-- Every table / view / snapshot in public (not counting extension-owned ones).
rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_depend e where e.objid = c.oid and e.deptype = 'e')
),

-- Data probes. They run through query_to_xml, so a missing table shows up as a
-- FAIL row instead of stopping the whole check.
q as (
  select k,
         case when to_regclass(need) is null then null
              else replace(replace(replace(
                     (xpath('/row/v/text()', query_to_xml(qry, false, true, '')))[1]::text,
                     '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
         end as v
  from (values
    ('sales_rows',  'public.sales_data',
       'select count(*) as v from public.sales_data'),
    ('last_sale',   'public.sales_data',
       'select max(sale_date)::date as v from public.sales_data'),
    ('no_calc',     'public.sales_data',
       'select count(*) as v from public.sales_data where sale_date is not null and (fy_year is null or quarter is null or month_year is null)'),
    ('no_date',     'public.sales_data',
       'select count(*) as v from public.sales_data where sale_date is null'),
    ('snap_rows',   'public.mv_sales_type_agg',
       'select coalesce(sum(txn_count), 0) as v from public.mv_sales_type_agg'),
    ('out_rows',    'public.outstanding_master',
       'select count(*) as v from public.outstanding_master'),
    ('tgt_rows',    'public.target_master',
       'select count(*) as v from public.target_master'),
    ('admins',      'public.dashboard_users',
       'select count(*) as v from public.dashboard_users where is_active and role in (''super_admin'', ''admin'')'),
    ('bad_roles',   'public.dashboard_users',
       'select string_agg(username || '' ('' || coalesce(role, ''none'') || '')'', '', '') as v from public.dashboard_users where role is null or role not in (''super_admin'', ''admin'', ''hod'', ''zonal_head'')'),
    ('no_scope',    'public.dashboard_users',
       'select string_agg(username, '', '') as v from public.dashboard_users where is_active and ((role = ''hod'' and cardinality(allowed_hods) = 0) or (role = ''zonal_head'' and cardinality(allowed_zones) = 0))'),
    ('logins_7d',   'public.dashboard_login_logs',
       'select count(*) as v from public.dashboard_login_logs where event = ''login'' and created_at > now() - interval ''7 days'''),
    ('failed_24h',  'public.dashboard_login_logs',
       'select count(*) as v from public.dashboard_login_logs where event = ''login_failed'' and created_at > now() - interval ''24 hours'''),
    ('multi_state', 'public.vw_hod_state',
       'select string_agg(hod_name, '', '') as v from (select hod_name from public.vw_hod_state group by hod_name having count(*) > 1) x')
  ) t(k, need, qry)
),
d as (
  select
    (max(v) filter (where k = 'sales_rows'))::bigint as sales_rows,
    (max(v) filter (where k = 'last_sale'))::date    as last_sale,
    (max(v) filter (where k = 'no_calc'))::bigint    as no_calc,
    (max(v) filter (where k = 'no_date'))::bigint    as no_date,
    (max(v) filter (where k = 'snap_rows'))::bigint  as snap_rows,
    (max(v) filter (where k = 'out_rows'))::bigint   as out_rows,
    (max(v) filter (where k = 'tgt_rows'))::bigint   as tgt_rows,
    (max(v) filter (where k = 'admins'))::bigint     as admins,
    max(v) filter (where k = 'bad_roles')            as bad_roles,
    max(v) filter (where k = 'no_scope')             as no_scope,
    (max(v) filter (where k = 'logins_7d'))::bigint  as logins_7d,
    (max(v) filter (where k = 'failed_24h'))::bigint as failed_24h,
    max(v) filter (where k = 'multi_state')          as multi_state
  from q
),

checks(status, area, item, detail) as (

  -- ── Objects ────────────────────────────────────────────────────────────
  select case when count(*) filter (where to_regclass('public.' || rel) is null) = 0 then 'PASS' else 'FAIL' end,
         'Objects', 'Required tables and views',
         coalesce('MISSING: ' || string_agg(rel, ', ') filter (where to_regclass('public.' || rel) is null),
                  'all ' || count(*) || ' present')
  from req

  union all
  select case when count(*) filter (where to_regclass('public.' || rel) is null) = 0 then 'PASS' else 'INFO' end,
         'Objects', 'Optional views',
         coalesce('not present; the server falls back without them: '
                  || string_agg(rel, ', ') filter (where to_regclass('public.' || rel) is null),
                  'all ' || count(*) || ' present')
  from opt

  union all
  select case when count(*) = 0 then 'PASS' else 'WARN' end,
         'Objects', 'State/City views removed (migration 17 / 18)',
         coalesce('still present: ' || string_agg(rel, ', '), 'removed')
  from dropped
  where to_regclass('public.' || rel) is not null

  -- ── Snapshots ──────────────────────────────────────────────────────────
  union all
  select case when count(*) filter (where to_regclass('public.' || rel) is null) = 0 then 'PASS' else 'WARN' end,
         'Snapshots', 'Expected snapshots exist',
         coalesce('missing (those pages read the slower live view): '
                  || string_agg(rel, ', ') filter (where to_regclass('public.' || rel) is null),
                  'all ' || count(*) || ' present')
  from snap

  union all
  select case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'Snapshots', 'Every snapshot has been populated',
         coalesce('never refreshed, reads fail: ' || string_agg(matviewname::text, ', '), 'yes')
  from pg_matviews
  where schemaname = 'public' and not ispopulated

  union all
  select case when d.snap_rows is not null and d.snap_rows = d.sales_rows then 'PASS' else 'WARN' end,
         'Snapshots', 'Snapshots in step with sales_data',
         case when d.snap_rows is null then 'mv_sales_type_agg missing, cannot compare'
              when d.snap_rows = d.sales_rows then 'in step (' || d.snap_rows || ' rows)'
              else 'STALE: snapshot counts ' || d.snap_rows || ' rows, sales_data has ' || d.sales_rows
                   || '. Run a sync, or: select public.refresh_dashboard_views();' end
  from d

  union all
  select case when count(*) = 0 then 'PASS' else 'INFO' end,
         'Snapshots', 'No unexpected snapshots',
         coalesce('also refreshed on every sync: ' || string_agg(matviewname::text, ', '), 'none')
  from pg_matviews
  where schemaname = 'public' and matviewname::text not in (select rel from snap)

  union all
  select case when count(*) = 0 then 'PASS'
              when max(now() - query_start) > interval '10 minutes' then 'WARN'
              else 'INFO' end,
         'Snapshots', 'No snapshot refresh stuck right now',
         coalesce(count(*) || ' refresh running, longest ' || to_char(max(now() - query_start), 'HH24:MI:SS')
                  || case when max(now() - query_start) > interval '10 minutes'
                          then '. Dashboard reads of that snapshot wait for it.' else '' end,
                  'none running')
  from pg_stat_activity
  where pid <> pg_backend_pid()
    and state = 'active'
    and (query ilike '%refresh_dashboard_views%' or query ilike '%refresh materialized view%')

  -- ── Functions and sync ─────────────────────────────────────────────────
  union all
  select case when count(*) filter (where p.oid is null) = 0 then 'PASS' else 'FAIL' end,
         'Functions', 'refresh_dashboard_views and truncate_sales_data exist',
         coalesce('MISSING: ' || string_agg(f.name, ', ') filter (where p.oid is null), 'all present')
  from fn f
  left join lateral (
    select pp.oid
    from pg_proc pp
    join pg_namespace n on n.oid = pp.pronamespace
    where n.nspname = 'public' and pp.proname = f.name
    limit 1
  ) p on true

  union all
  select case when exists (select 1 from pg_proc pp join pg_namespace n on n.oid = pp.pronamespace
                           where n.nspname = 'public' and pp.proname = 'get_filter_options')
              then 'PASS' else 'INFO' end,
         'Functions', 'get_filter_options (optional)',
         case when exists (select 1 from pg_proc pp join pg_namespace n on n.oid = pp.pronamespace
                           where n.nspname = 'public' and pp.proname = 'get_filter_options')
              then 'present' else 'not present; filters load from mv_filter_options instead' end

  union all
  select case when count(*) = 0 then 'FAIL'
              when bool_and(p.prosecdef and pg_get_functiondef(p.oid) ilike '%pg_matviews%') then 'PASS'
              else 'WARN' end,
         'Functions', 'refresh_dashboard_views() is the migration 17 version',
         case when count(*) = 0 then 'missing'
              when bool_and(p.prosecdef and pg_get_functiondef(p.oid) ilike '%pg_matviews%')
                then 'refreshes every snapshot that exists'
              else 'older version: run db/migrations/18_reapply_17_and_lock_truncate.sql' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'refresh_dashboard_views'

  union all
  select case when count(*) filter (where t.tgenabled <> 'D') > 0 then 'PASS' else 'FAIL' end,
         'Sync', 'Trigger that fills FY / quarter / month on sales_data',
         case when count(*) = 0 then 'trg_calc_sales_data_fields missing: new rows get no FY/quarter/month (migration 05)'
              when count(*) filter (where t.tgenabled <> 'D') > 0 then 'enabled'
              else 'trg_calc_sales_data_fields is DISABLED' end
  from pg_trigger t
  where t.tgname = 'trg_calc_sales_data_fields'
    and t.tgrelid = to_regclass('public.sales_data')::oid

  -- ── Security ───────────────────────────────────────────────────────────
  union all
  select case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'Security', 'anon / authenticated cannot reach any data',
         coalesce('EXPOSED: ' || string_agg(distinct x.relname || ' (' || x.role || ')', ', '), 'nothing reachable')
  from (
    select r.relname::text as relname, g.role
    from rels r
    cross join (values ('anon'), ('authenticated')) g(role)
    where exists (select 1 from pg_roles where rolname = g.role)
      and has_table_privilege(g.role, r.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and (r.relkind in ('v', 'm')
           or not r.relrowsecurity
           or exists (select 1 from pg_policies pol
                      where pol.schemaname = 'public' and pol.tablename = r.relname
                        and pol.roles && array['public', g.role]::name[]))
  ) x

  union all
  select case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'Security', 'anon / authenticated cannot run dashboard functions',
         coalesce('CALLABLE: ' || string_agg(distinct p.proname || ' (' || g.role || ')', ', '), 'none callable')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) g(role)
  where n.nspname = 'public'
    and exists (select 1 from pg_roles where rolname = g.role)
    and (p.proname in ('refresh_dashboard_views', 'truncate_sales_data', 'get_filter_options',
                       'api_top_skus', 'api_size_agg', 'get_enterprise_kpis', 'get_db_row_count')
         -- any SECURITY DEFINER function runs as its owner, so it must not be public either
         or (p.prosecdef
             and p.prorettype <> 'trigger'::regtype
             and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')))
    and has_function_privilege(g.role, p.oid, 'EXECUTE')

  union all
  select case when count(*) = 0 then 'PASS' else 'FAIL' end,
         'Security', 'Server (service_role) can read and sync everything',
         coalesce('NO ACCESS: ' || string_agg(s.what, ', '), 'ok')
  from (
    select r.relname::text as what
    from rels r
    where (r.relname::text in (select rel from req)
           or r.relname::text in (select rel from opt)
           or r.relkind = 'm')
      and not has_table_privilege('service_role', r.oid, 'SELECT')
    union all
    select t || ' (write)'
    from unnest(array['sales_data', 'outstanding_master', 'target_master',
                      'dashboard_users', 'dashboard_login_logs', 'app_settings']) t
    where to_regclass('public.' || t) is not null
      and not (has_table_privilege('service_role', to_regclass('public.' || t), 'INSERT')
               and has_table_privilege('service_role', to_regclass('public.' || t), 'UPDATE')
               and has_table_privilege('service_role', to_regclass('public.' || t), 'DELETE'))
    union all
    select pp.proname || '()'
    from pg_proc pp
    join pg_namespace n on n.oid = pp.pronamespace
    where n.nspname = 'public'
      and pp.proname::text in (select name from fn)
      and not has_function_privilege('service_role', pp.oid, 'EXECUTE')
  ) s

  -- ── Data ───────────────────────────────────────────────────────────────
  union all
  select case when coalesce(d.sales_rows, 0) > 0 then 'PASS' else 'FAIL' end,
         'Data', 'sales_data has rows',
         coalesce(to_char(d.sales_rows, 'FM999,999,999,999') || ' rows', 'table missing')
  from d

  union all
  select case when d.last_sale is null then 'FAIL'
              when current_date - d.last_sale <= 7 then 'PASS'
              else 'WARN' end,
         'Data', 'Latest sale date',
         coalesce(to_char(d.last_sale, 'DD Mon YYYY') || ' (' || (current_date - d.last_sale) || ' days ago)'
                  || case when current_date - d.last_sale > 7 then '. A sync from the sheet may be overdue.' else '' end,
                  'no dated rows')
  from d

  union all
  select case when coalesce(d.no_calc, 0) = 0 then 'PASS' else 'WARN' end,
         'Data', 'Dated rows have FY / quarter / month',
         case when d.no_calc is null then 'sales_data missing'
              when d.no_calc = 0 then 'all of them'
              else d.no_calc || ' rows have none; filters and trends skip them' end
  from d

  union all
  select case when coalesce(d.no_date, 0) = 0 then 'PASS' else 'WARN' end,
         'Data', 'Rows have a sale date',
         case when d.no_date is null then 'sales_data missing'
              when d.no_date = 0 then 'all of them'
              else d.no_date || ' rows have no sale_date; they fall in no month' end
  from d

  union all
  select case when coalesce(d.out_rows, 0) > 0 then 'PASS' else 'WARN' end,
         'Data', 'Outstanding data loaded',
         coalesce(d.out_rows || ' rows in outstanding_master', 'table missing')
  from d

  union all
  select case when coalesce(d.tgt_rows, 0) > 0 then 'PASS' else 'WARN' end,
         'Data', 'Targets loaded',
         coalesce(d.tgt_rows || ' rows in target_master', 'table missing')
  from d

  union all
  select 'INFO', 'Data', 'HODs with more than one HOD state',
         case when to_regclass('public.vw_hod_state') is null then 'vw_hod_state missing'
              else coalesce(d.multi_state, 'none') || '. The server shows the first label it reads for each.' end
  from d

  -- ── Users ──────────────────────────────────────────────────────────────
  union all
  select case when coalesce(d.admins, 0) > 0 then 'PASS' else 'FAIL' end,
         'Users', 'At least one active admin',
         coalesce(d.admins || ' active admin / super admin account(s)', 'dashboard_users missing')
  from d

  union all
  select case when d.bad_roles is null then 'PASS' else 'WARN' end,
         'Users', 'Every account has a known role',
         coalesce('unknown role: ' || d.bad_roles, 'yes')
  from d

  union all
  select case when d.no_scope is null then 'PASS' else 'WARN' end,
         'Users', 'HOD / zonal head accounts have a scope',
         coalesce('nothing assigned, so they see no data: ' || d.no_scope, 'yes')
  from d

  union all
  select case when coalesce(d.failed_24h, 0) > 20 then 'WARN' else 'INFO' end,
         'Users', 'Sign-in activity',
         coalesce(d.logins_7d || ' sign-ins in the last 7 days, ' || d.failed_24h || ' failed in the last 24 hours',
                  'dashboard_login_logs missing')
  from d

  -- ── Database ───────────────────────────────────────────────────────────
  union all
  select 'INFO', 'Database', 'Size',
         pg_size_pretty(pg_database_size(current_database())) || ' in total; sales_data '
         || coalesce(pg_size_pretty(pg_total_relation_size(to_regclass('public.sales_data'))), 'missing')
)
select status, area, item, detail
from checks
order by case status when 'FAIL' then 1 when 'WARN' then 2 when 'PASS' then 3 else 4 end, area, item;
