-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 08: HOD -> HOD_STATE lookup view
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Exposes the distinct hod_name -> hod_state pairs as a tiny view (~32 rows).
--
-- WHY A LOOKUP INSTEAD OF A NEW COLUMN ON EVERY VIEW:
-- HOD_STATE is an attribute of the HOD (their territory), not of the sale --
-- verified against the source sheets: 31 of 32 HODs have exactly one value.
-- Resolving it once by hod_name means every existing aggregate view
-- (vw_monthly_agg, vw_hod_agg, vw_brand_agg, vw_sku_agg, vw_customer_sale_agg,
-- vw_sku_type_sale_agg, vw_customer_summary, vw_filter_options) and both RPCs
-- keep working untouched -- they all already carry hod_name.
--
-- It also backfills FY 24-25, whose source sheet has no HOD_STATE column at
-- all: those rows inherit their HOD's territory from the newer sheets.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run. Requires migration 07.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_hod_state AS
SELECT DISTINCT
  hod_name,
  hod_state
FROM sales_data
WHERE hod_name  IS NOT NULL AND btrim(hod_name)  <> ''
  AND hod_state IS NOT NULL AND btrim(hod_state) <> '';

GRANT SELECT ON vw_hod_state TO anon, authenticated, service_role;
