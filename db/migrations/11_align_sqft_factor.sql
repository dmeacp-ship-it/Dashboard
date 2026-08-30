-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 11: Align the sq m -> sq ft factor on 10.764
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run the three steps BELOW ONE AT A TIME, not as a single paste.
-- Step 2 updates ~77k rows and step 3 rebuilds ten materialized views; run
-- together they exceed the SQL editor's statement timeout, which is why an
-- earlier all-in-one attempt left the trigger unchanged.
--
-- Verify afterwards with:
--   SELECT total_sqm, sq_ft, sq_ft/total_sqm AS factor
--   FROM sales_data WHERE total_sqm > 50 LIMIT 3;
--   -- factor should read 10.7640000
-- ═══════════════════════════════════════════════════════════════════════════


-- ── STEP 1 of 3 — replace the trigger (fast) ───────────────────────────────
-- Only the sq_ft line differs from migration 05; the FY / quarter /
-- month_year logic is carried over verbatim.

CREATE OR REPLACE FUNCTION calc_sales_data_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_fy TEXT;
  v_qtr TEXT;
BEGIN
  -- Auto-calculate SQ FT from TOTAL SQM (SQFT_PER_SQM = 10.764)
  IF NEW.total_sqm IS NOT NULL THEN
    NEW.sq_ft := ROUND((NEW.total_sqm * 10.764)::NUMERIC, 4);
  END IF;

  IF NEW.sale_date IS NOT NULL THEN
    IF EXTRACT(MONTH FROM NEW.sale_date) >= 4 THEN
      v_fy := 'FY-' || TO_CHAR(NEW.sale_date, 'YY') || '-' || TO_CHAR(NEW.sale_date + INTERVAL '1 year', 'YY');
    ELSE
      v_fy := 'FY-' || TO_CHAR(NEW.sale_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(NEW.sale_date, 'YY');
    END IF;
    NEW.fy_year := v_fy;

    IF EXTRACT(MONTH FROM NEW.sale_date) IN (4, 5, 6) THEN
      v_qtr := 'Q-1';
    ELSIF EXTRACT(MONTH FROM NEW.sale_date) IN (7, 8, 9) THEN
      v_qtr := 'Q-2';
    ELSIF EXTRACT(MONTH FROM NEW.sale_date) IN (10, 11, 12) THEN
      v_qtr := 'Q-3';
    ELSE
      v_qtr := 'Q-4';
    END IF;

    NEW.quarter := v_fy || ' ' || v_qtr;
    NEW.month_year := TO_CHAR(NEW.sale_date, 'Mon-YY');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── STEP 2 of 3 — backfill existing rows ───────────────────────────────────
-- Re-run this until it reports 0 rows updated. The WHERE clause skips rows
-- already on the new factor, so it is safe to run repeatedly and each pass
-- shrinks the remaining set if it times out partway.

-- UPDATE sales_data
-- SET sq_ft = ROUND((total_sqm * 10.764)::NUMERIC, 4)
-- WHERE total_sqm IS NOT NULL
--   AND sq_ft IS DISTINCT FROM ROUND((total_sqm * 10.764)::NUMERIC, 4);


-- ── STEP 3 of 3 — rebuild the snapshots ────────────────────────────────────
-- The aggregate snapshots sum sq_ft, so they hold the old numbers until this
-- runs. If it times out, refresh them individually instead.

-- SELECT refresh_dashboard_views();
