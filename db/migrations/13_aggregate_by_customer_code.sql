-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 13: Group Customer Sale Aggregations by Customer Code
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Updates `vw_customer_sale_agg` and its materialized snapshot `mv_customer_sale_agg`
-- to group by `customer_code` instead of `customer_name`.
--
-- WHY THIS IS NEEDED:
-- Previously, uniqueness was determined by customer_name. When a single customer
-- had multiple spelling or branch suffixes in raw transactions (e.g. "GAYATHREE AGENCIES"
-- vs "GAYATHREE AGENCIES - HYDERABAD" under customer code VAICU000417), their sales
-- were split across multiple rows in the Customer Sales table.
--
-- Grouping by customer_code combines all sales for that customer under a single
-- unique identifier, while preserving the canonical customer_name via MAX().
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
