-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 05: Add New Columns & Configure Auto-Calculated Fields in Supabase
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- 1. Adds new columns to `sales_data`:
--    - bill_number_sap      (SAP Invoice / Bill Number)
--    - color_code           (Product Color Code)
--    - city                 (Customer City)
--    - project_pct          (Project Percentage Share)
--    - project_sales_person (Project Sales Person Name)
--
-- 2. Sets up a BEFORE INSERT OR UPDATE trigger (`trg_calc_sales_data_fields`) to
--    automatically compute the following fields directly inside Supabase:
--    - sq_ft       = ROUND(total_sqm * 10.7639104, 4)
--    - fy_year     = Indian FY based on sale_date (e.g. 'FY-25-26')
--    - quarter     = Combined FY + Quarter (e.g. 'FY-25-26 Q-1')
--    - month_year  = Formatted Month-Year (e.g. 'Apr-25')
--
-- 3. Backfills existing rows in `sales_data` to ensure all historical records
--    have complete, standardized values.
--
-- 4. Refreshes all materialized views.
--
-- HOW TO RUN:
-- Copy and paste this entire script into your Supabase SQL Editor and click "Run".
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add new columns if they do not exist
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS bill_number_sap TEXT;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS color_code TEXT;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS project_pct NUMERIC;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS project_sales_person TEXT;
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS prev_hod_name TEXT;
ALTER TABLE sales_data ALTER COLUMN sales_type SET DEFAULT 'Retail';

-- 2. Create the Trigger Function to auto-calculate fields on Insert or Update
CREATE OR REPLACE FUNCTION calc_sales_data_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_fy TEXT;
  v_qtr TEXT;
BEGIN
  -- Auto-calculate SQ FT from TOTAL SQM
  IF NEW.total_sqm IS NOT NULL THEN
    NEW.sq_ft := ROUND((NEW.total_sqm * 10.7639104)::NUMERIC, 4);
  END IF;

  -- Auto-calculate FY_YEAR, QUARTER ("FY-YY-YY Q-X"), and MONTH_YEAR from sale_date
  IF NEW.sale_date IS NOT NULL THEN
    -- Financial Year (Apr to Mar)
    IF EXTRACT(MONTH FROM NEW.sale_date) >= 4 THEN
      v_fy := 'FY-' || TO_CHAR(NEW.sale_date, 'YY') || '-' || TO_CHAR(NEW.sale_date + INTERVAL '1 year', 'YY');
    ELSE
      v_fy := 'FY-' || TO_CHAR(NEW.sale_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(NEW.sale_date, 'YY');
    END IF;
    NEW.fy_year := v_fy;

    -- Financial Quarter Suffix (Q-1, Q-2, Q-3, Q-4)
    IF EXTRACT(MONTH FROM NEW.sale_date) IN (4, 5, 6) THEN
      v_qtr := 'Q-1';
    ELSIF EXTRACT(MONTH FROM NEW.sale_date) IN (7, 8, 9) THEN
      v_qtr := 'Q-2';
    ELSIF EXTRACT(MONTH FROM NEW.sale_date) IN (10, 11, 12) THEN
      v_qtr := 'Q-3';
    ELSE
      v_qtr := 'Q-4';
    END IF;

    -- Format Quarter as "FY-YY-YY Q-X" (e.g. "FY-25-26 Q-1")
    NEW.quarter := v_fy || ' ' || v_qtr;

    -- Month-Year (e.g. "Apr-25")
    NEW.month_year := TO_CHAR(NEW.sale_date, 'Mon-YY');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger to sales_data
DROP TRIGGER IF EXISTS trg_calc_sales_data_fields ON sales_data;
CREATE TRIGGER trg_calc_sales_data_fields
BEFORE INSERT OR UPDATE ON sales_data
FOR EACH ROW
EXECUTE FUNCTION calc_sales_data_fields();

-- 4. Backfill existing records in sales_data
UPDATE sales_data
SET
  sq_ft = CASE 
    WHEN total_sqm IS NOT NULL THEN ROUND((total_sqm * 10.7639104)::NUMERIC, 4)
    ELSE sq_ft 
  END,
  fy_year = CASE 
    WHEN sale_date IS NOT NULL THEN (
      CASE WHEN EXTRACT(MONTH FROM sale_date) >= 4 
        THEN 'FY-' || TO_CHAR(sale_date, 'YY') || '-' || TO_CHAR(sale_date + INTERVAL '1 year', 'YY')
        ELSE 'FY-' || TO_CHAR(sale_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(sale_date, 'YY')
      END
    )
    ELSE fy_year
  END,
  quarter = CASE 
    WHEN sale_date IS NOT NULL THEN (
      (CASE WHEN EXTRACT(MONTH FROM sale_date) >= 4 
        THEN 'FY-' || TO_CHAR(sale_date, 'YY') || '-' || TO_CHAR(sale_date + INTERVAL '1 year', 'YY')
        ELSE 'FY-' || TO_CHAR(sale_date - INTERVAL '1 year', 'YY') || '-' || TO_CHAR(sale_date, 'YY')
      END) || ' ' || (
        CASE 
          WHEN EXTRACT(MONTH FROM sale_date) IN (4, 5, 6)   THEN 'Q-1'
          WHEN EXTRACT(MONTH FROM sale_date) IN (7, 8, 9)   THEN 'Q-2'
          WHEN EXTRACT(MONTH FROM sale_date) IN (10, 11, 12) THEN 'Q-3'
          ELSE 'Q-4'
        END
      )
    )
    ELSE quarter
  END,
  month_year = CASE 
    WHEN sale_date IS NOT NULL THEN TO_CHAR(sale_date, 'Mon-YY')
    ELSE month_year
  END
WHERE sale_date IS NOT NULL OR total_sqm IS NOT NULL;

-- 5. Fast RPC for Hard Reset (avoids lock timeouts during full table clear)
CREATE OR REPLACE FUNCTION truncate_sales_data()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE sales_data RESTART IDENTITY;
END;
$$;

-- 6. Refresh all materialized views so they reflect calculated values
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_dashboard_views') THEN
    PERFORM refresh_dashboard_views();
  END IF;
END $$;
