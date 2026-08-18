-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 06: Create Retail vs Project Sales Aggregation View
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates a new view `vw_sales_type_agg` that groups sales by `sales_type` 
-- (Retail vs Projects) so the dashboard can display the split KPI card.
--
-- HOW TO RUN:
-- Copy and paste this entire script into your Supabase SQL Editor and click "Run".
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_sales_type_agg AS
SELECT 
  fy_year,
  quarter,
  month_year,
  zone,
  state,
  hod_name,
  sales_type,
  SUM(total_sqm) as total_sqm,
  SUM(sq_ft) as sq_ft,
  SUM(quantity) as total_qty,
  COUNT(*) as txn_count,
  SUM(net_revenue) as net_revenue
FROM sales_data
GROUP BY fy_year, quarter, month_year, zone, state, hod_name, sales_type;

-- Grant access to authenticated users
GRANT SELECT ON vw_sales_type_agg TO authenticated;
GRANT SELECT ON vw_sales_type_agg TO service_role;
GRANT SELECT ON vw_sales_type_agg TO anon;
