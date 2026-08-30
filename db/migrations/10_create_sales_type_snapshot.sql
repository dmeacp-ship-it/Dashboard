-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 10: Materialized snapshot for vw_sales_type_agg
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Adds mv_sales_type_agg and wires it into refresh_dashboard_views().
--
-- WHY:
-- vw_sales_type_agg (migration 06, powering the Retail vs Projects card) is
-- the only dashboard view with no materialized snapshot. Every request
-- re-runs its GROUP BY against the whole sales_data table; measured live it
-- ran past 30s while every mv_-backed view answered in under a second. That
-- one leg was enough to make the browser report "Dashboard failed to load
-- data".
--
-- The backend auto-detects mv_* relations and prefers them, so this takes
-- effect as soon as it is applied -- no code change needed.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run. Requires migration 06.
-- ═══════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_sales_type_agg;
CREATE MATERIALIZED VIEW mv_sales_type_agg AS SELECT * FROM vw_sales_type_agg;
CREATE INDEX idx_mv_sales_type_agg_time ON mv_sales_type_agg (fy_year, quarter);
CREATE INDEX idx_mv_sales_type_agg_geo  ON mv_sales_type_agg (zone, state, hod_name);

-- Rebuild the refresh hook so the new snapshot is kept in step with the rest.
-- Order matches db/perf_phase2.sql; mv_sku_meta stays last because it reads
-- from mv_sku_agg.
DROP FUNCTION IF EXISTS refresh_dashboard_views();
CREATE FUNCTION refresh_dashboard_views()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_monthly_agg;
  REFRESH MATERIALIZED VIEW mv_hod_agg;
  REFRESH MATERIALIZED VIEW mv_customer_sale_agg;
  REFRESH MATERIALIZED VIEW mv_sku_type_sale_agg;
  REFRESH MATERIALIZED VIEW mv_brand_agg;
  REFRESH MATERIALIZED VIEW mv_sku_agg;
  REFRESH MATERIALIZED VIEW mv_filter_options;
  REFRESH MATERIALIZED VIEW mv_customer_summary;
  REFRESH MATERIALIZED VIEW mv_sales_type_agg;
  REFRESH MATERIALIZED VIEW mv_sku_meta;
END;
$$;

GRANT SELECT ON mv_sales_type_agg TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_dashboard_views() TO anon, authenticated, service_role;

SELECT refresh_dashboard_views();
