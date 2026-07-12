-- ═══════════════════════════════════════════════════════════════════════════
-- Performance: materialized snapshots of the dashboard aggregation views
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY: the vw_*_agg views are computed from the raw sales table on every
-- request. The API pages through them 1000 rows at a time, and every page
-- re-executes the whole view (e.g. vw_sku_agg = ~49 pages, ~20s per cache
-- miss). Materializing them turns each page into a trivial index-range read.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL editor and run it.
-- The backend auto-detects the mv_* relations and uses them when present;
-- until then it keeps using the plain views, so this can be applied any time.
--
-- FRESHNESS: refresh_dashboard_views() is (re)defined below to refresh all
-- snapshots. The sync engine already calls it after every data sync
-- (sync.service.js -> _finishSync), so the snapshots stay in step with the
-- underlying data automatically.

-- ── Snapshots ────────────────────────────────────────────────────────────────
drop materialized view if exists mv_monthly_agg;
create materialized view mv_monthly_agg as select * from vw_monthly_agg;
create index idx_mv_monthly_agg_time on mv_monthly_agg (fy_year, quarter);
create index idx_mv_monthly_agg_geo  on mv_monthly_agg (zone, state, hod_name);

drop materialized view if exists mv_hod_agg;
create materialized view mv_hod_agg as select * from vw_hod_agg;
create index idx_mv_hod_agg_time on mv_hod_agg (fy_year, quarter);
create index idx_mv_hod_agg_geo  on mv_hod_agg (zone, state, hod_name);

-- vw_customer_sale_agg / vw_sku_type_sale_agg have no `zone` column (state + hod_name only).
drop materialized view if exists mv_customer_sale_agg;
create materialized view mv_customer_sale_agg as select * from vw_customer_sale_agg;
create index idx_mv_customer_sale_agg_time on mv_customer_sale_agg (fy_year, quarter);
create index idx_mv_customer_sale_agg_geo  on mv_customer_sale_agg (state, hod_name);

drop materialized view if exists mv_sku_type_sale_agg;
create materialized view mv_sku_type_sale_agg as select * from vw_sku_type_sale_agg;
create index idx_mv_sku_type_sale_agg_time on mv_sku_type_sale_agg (fy_year, quarter);
create index idx_mv_sku_type_sale_agg_geo  on mv_sku_type_sale_agg (state, hod_name);

drop materialized view if exists mv_brand_agg;
create materialized view mv_brand_agg as select * from vw_brand_agg;
create index idx_mv_brand_agg_time on mv_brand_agg (fy_year, quarter);
create index idx_mv_brand_agg_geo  on mv_brand_agg (zone, state, hod_name);

drop materialized view if exists mv_sku_agg;
create materialized view mv_sku_agg as select * from vw_sku_agg;
create index idx_mv_sku_agg_time  on mv_sku_agg (fy_year, quarter);
create index idx_mv_sku_agg_geo   on mv_sku_agg (zone, state, hod_name);
create index idx_mv_sku_agg_brand on mv_sku_agg (brand, sku_type);

drop materialized view if exists mv_filter_options;
create materialized view mv_filter_options as select * from vw_filter_options;

-- ── Refresh hook (called by the sync engine after every data sync) ──────────
-- Drop first: an older refresh_dashboard_views() may already exist (the sync
-- engine calls it), and `create or replace` cannot change an existing
-- function's return type in place.
drop function if exists refresh_dashboard_views();
create or replace function refresh_dashboard_views()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view mv_monthly_agg;
  refresh materialized view mv_hod_agg;
  refresh materialized view mv_customer_sale_agg;
  refresh materialized view mv_sku_type_sale_agg;
  refresh materialized view mv_brand_agg;
  refresh materialized view mv_sku_agg;
  refresh materialized view mv_filter_options;
end;
$$;

-- ── API access ───────────────────────────────────────────────────────────────
grant select on mv_monthly_agg, mv_hod_agg, mv_customer_sale_agg,
  mv_sku_type_sale_agg, mv_brand_agg, mv_sku_agg, mv_filter_options
  to anon, authenticated, service_role;
grant execute on function refresh_dashboard_views() to anon, authenticated, service_role;

-- Populate now so the API can switch over immediately.
select refresh_dashboard_views();
