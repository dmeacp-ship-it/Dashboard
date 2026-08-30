-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 09: Executive (sales person) wise sale aggregation view
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates `vw_executive_sale_agg`, backing the "Executive Sales" table under
-- Sale Performance. It mirrors vw_customer_sale_agg exactly, but keys on
-- sales_person instead of customer_name.
--
-- WHY A NEW VIEW:
-- No existing aggregate view carries sales_person -- vw_hod_agg,
-- vw_monthly_agg, vw_customer_sale_agg and vw_sku_type_sale_agg all stop at
-- hod_name. Only the raw sales_data table has the column, so the executive
-- breakdown needs its own rollup.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_executive_sale_agg AS
SELECT
  fy_year,
  quarter,
  month_year,
  zone,
  state,
  hod_name,
  sales_person,
  SUM(total_sqm)   AS total_sqm,
  SUM(sq_ft)       AS sq_ft,
  SUM(quantity)    AS total_qty,
  SUM(net_revenue) AS net_revenue,
  COUNT(*)         AS txn_count
FROM sales_data
WHERE sales_person IS NOT NULL AND btrim(sales_person) <> ''
GROUP BY fy_year, quarter, month_year, zone, state, hod_name, sales_person;

GRANT SELECT ON vw_executive_sale_agg TO anon, authenticated, service_role;
