-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 12: Project (project sales person) wise aggregation view
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates `vw_project_sale_agg`, backing the "Project Sales" table under Sale
-- Performance. Same shape as vw_executive_sale_agg (migration 09) but limited
-- to project business.
--
-- WHY A SEPARATE VIEW:
-- vw_executive_sale_agg has no sales_type column, so it cannot be filtered to
-- projects. Adding sales_type there would split every executive row in two and
-- change that view's granularity; a dedicated view leaves the working
-- Executive table untouched and stays small (projects are a few percent of
-- rows).
--
-- NOTE ON sales_person:
-- The sync splits a row with PROJECT% into a Projects part and a Retail part,
-- and on the Projects part it overwrites sales_person with
-- PROJECT_SALES_PERSON (sync.service.js). So grouping by sales_person here
-- yields the project sales people, which is what the table shows.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_project_sale_agg AS
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
WHERE sales_type = 'Projects'
  AND sales_person IS NOT NULL AND btrim(sales_person) <> ''
GROUP BY fy_year, quarter, month_year, zone, state, hod_name, sales_person;

GRANT SELECT ON vw_project_sale_agg TO anon, authenticated, service_role;
