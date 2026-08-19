-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 07: Add HOD_STATE column
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Adds the new `hod_state` column to the `sales_data` table so that it 
-- matches the newly added column in the Google Sheets.
--
-- HOW TO RUN:
-- Copy and paste this entire script into your Supabase SQL Editor and click "Run".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS hod_state TEXT;
