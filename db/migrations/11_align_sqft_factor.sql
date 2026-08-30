-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 11: Align the sq m -> sq ft factor on 10.764
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Redefines calc_sales_data_fields() so the stored sales_data.sq_ft column is
-- computed with 10.764, then backfills every existing row.
--
-- WHY:
-- The source sheets carry TOTAL_SQM only; sq ft is derived. The factor used to
-- be spelled three different ways across the codebase (10.7639104 in the
-- trigger and sync, 10.76391 in the dashboard, 10.7639 in FMS). It is now the
-- single constant SQFT_PER_SQM = 10.764 in src/config.js and
-- window.SQFT_PER_SQM in the frontend; this brings the database in step so a
-- stored sq_ft and a recomputed one never disagree.
--
-- Only the sq_ft line differs from migration 05 -- the FY / quarter /
-- month_year logic below is carried over verbatim so the trigger keeps doing
-- everything it did before.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Auto-calculate FY_YEAR, QUARTER ("FY-YY-YY Q-X"), and MONTH_YEAR from sale_date
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

-- Backfill existing rows onto the new factor.
UPDATE sales_data
SET sq_ft = ROUND((total_sqm * 10.764)::NUMERIC, 4)
WHERE total_sqm IS NOT NULL;

-- The aggregate snapshots sum sq_ft, so they have to be rebuilt.
SELECT refresh_dashboard_views();
