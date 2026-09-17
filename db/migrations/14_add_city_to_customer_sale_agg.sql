-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 14: Add City to Customer Sale Aggregations
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Updates `vw_customer_sale_agg` and its materialized snapshot `mv_customer_sale_agg`
-- to include the `city` column (using MAX(city) to aggregate).
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS mv_customer_sale_agg;
DROP VIEW IF EXISTS vw_customer_sale_agg;

CREATE VIEW vw_customer_sale_agg AS
SELECT
  state,
  hod_name,
  customer_code,
  MAX(customer_name) AS customer_name,
  MAX(city) AS city,
  fy_year,
  quarter,
  month_year,
  SUM(total_sqm)   AS total_sqm,
  SUM(sq_ft)       AS sq_ft,
  SUM(net_revenue) AS net_revenue
FROM sales_data
WHERE customer_code IS NOT NULL AND btrim(customer_code) <> ''
GROUP BY state, hod_name, customer_code, fy_year, quarter, month_year;

CREATE MATERIALIZED VIEW mv_customer_sale_agg AS
SELECT * FROM vw_customer_sale_agg;

CREATE INDEX IF NOT EXISTS idx_mv_customer_sale_agg_time ON mv_customer_sale_agg (fy_year, quarter);
CREATE INDEX IF NOT EXISTS idx_mv_customer_sale_agg_geo  ON mv_customer_sale_agg (state, hod_name);
CREATE INDEX IF NOT EXISTS idx_mv_customer_sale_agg_cust ON mv_customer_sale_agg (customer_code);

GRANT SELECT ON vw_customer_sale_agg, mv_customer_sale_agg TO anon, authenticated, service_role;
