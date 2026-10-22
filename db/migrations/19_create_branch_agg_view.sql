  -- ═══════════════════════════════════════════════════════════════════════════
  -- Migration 19: Branch-wise sales and bill counts
  -- ═══════════════════════════════════════════════════════════════════════════
  --
  -- WHAT THIS DOES:
  -- Creates `vw_branch_agg` and its snapshot `mv_branch_agg`: sales per branch
  -- per month, with the number of distinct bills. It backs two things:
  --   - Time-Wise Sales -> "Analyze by: Branch"
  --   - the Avg Order Size / Bills card on Top 80% Contributors
  --
  -- WHY A NEW VIEW:
  -- No existing view carries branch_name, and txn_count on the other views
  -- counts line items, not bills (one bill with three items counts as 3), so
  -- neither figure can be derived from them.
  --
  -- UNTIL THIS IS RUN:
  -- The Branch option shows a "not set up yet" message and the Avg Order Size
  -- card shows "-". Nothing else is affected.
  --
  -- FRESHNESS:
  -- refresh_dashboard_views() (migration 18) refreshes every snapshot it finds,
  -- so mv_branch_agg is kept in step after each sync with no further change.
  --
  -- ACCESS:
  -- Only the dashboard server reads these, with the service role key.
  --
  -- HOW TO RUN:
  -- Supabase -> SQL Editor -> New query -> paste -> Run. Safe to re-run.
  -- Then restart the dashboard server (it remembers a missing view until then).
  -- ═══════════════════════════════════════════════════════════════════════════
  
  drop materialized view if exists public.mv_branch_agg;
  
  create or replace view public.vw_branch_agg as
  select
    coalesce(nullif(btrim(branch_name), ''), 'Unknown') as branch_name,
    fy_year,
    quarter,
    month_year,
    zone,
    state,
    hod_name,
    sum(total_sqm)                  as total_sqm,
    sum(sq_ft)                      as sq_ft,
    sum(net_revenue)                as net_revenue,
    count(distinct bill_number_sap) as bill_count
  from public.sales_data
  group by 1, 2, 3, 4, 5, 6, 7;
  
  create materialized view public.mv_branch_agg as select * from public.vw_branch_agg;
  create index idx_mv_branch_agg_time on public.mv_branch_agg (fy_year, quarter);
  create index idx_mv_branch_agg_geo  on public.mv_branch_agg (zone, state, hod_name);
  
  revoke all on public.vw_branch_agg, public.mv_branch_agg from anon, authenticated;
  grant select on public.vw_branch_agg, public.mv_branch_agg to service_role;
