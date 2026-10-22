-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 22: Add EX_BASE_LOCATION column to sales_data
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- 1. Adds `ex_base_location` column to `sales_data` to store the Executive
--    Base Location from Google Sheets RAW DATA.
-- 2. Updates `vw_executive_city_agg` to use `ex_base_location` when present,
--    falling back to `city` for historical rows where it is empty.
--
-- HOW TO RUN:
-- Paste into Supabase SQL Editor and click Run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_data ADD COLUMN IF NOT EXISTS ex_base_location TEXT;

CREATE OR REPLACE VIEW public.vw_executive_city_agg AS
SELECT
  upper(btrim(sales_person)) AS sales_person,
  upper(btrim(coalesce(nullif(btrim(ex_base_location), ''), city))) AS city,
  SUM(sq_ft) AS sq_ft
FROM public.sales_data
WHERE sales_person IS NOT NULL AND btrim(sales_person) <> ''
  AND (
    (ex_base_location IS NOT NULL AND btrim(ex_base_location) <> '')
    OR (city IS NOT NULL AND btrim(city) <> '')
  )
GROUP BY 1, 2;

REVOKE ALL ON public.vw_executive_city_agg FROM anon, authenticated;
GRANT SELECT ON public.vw_executive_city_agg TO service_role;
