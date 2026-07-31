-- ============================================================================
-- Sync Constraints & Indexes Setup for Supabase
-- Run this script in the Supabase SQL Editor to enable ON CONFLICT upserts.
-- ============================================================================

-- 1. sales_data: ON CONFLICT (row_hash)
-- First clean up any existing duplicate row_hash values if present
DELETE FROM public.sales_data a 
USING public.sales_data b
WHERE a.ctid < b.ctid AND a.row_hash IS NOT NULL AND a.row_hash = b.row_hash;

-- Add UNIQUE constraint on row_hash
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sales_data_row_hash_key'
    ) THEN
        ALTER TABLE public.sales_data ADD CONSTRAINT sales_data_row_hash_key UNIQUE (row_hash);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_data_row_hash ON public.sales_data (row_hash);


-- 2. outstanding_master: ON CONFLICT (customer_code)
-- Clean up duplicate customer_code values if present
DELETE FROM public.outstanding_master a 
USING public.outstanding_master b
WHERE a.ctid < b.ctid AND a.customer_code IS NOT NULL AND a.customer_code = b.customer_code;

-- Add UNIQUE constraint on customer_code
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'outstanding_master_customer_code_key'
    ) THEN
        ALTER TABLE public.outstanding_master ADD CONSTRAINT outstanding_master_customer_code_key UNIQUE (customer_code);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outstanding_master_customer_code ON public.outstanding_master (customer_code);


-- 3. target_master: ON CONFLICT (row_hash)
-- Clean up duplicate row_hash values if present
DELETE FROM public.target_master a 
USING public.target_master b
WHERE a.ctid < b.ctid AND a.row_hash IS NOT NULL AND a.row_hash = b.row_hash;

-- Add UNIQUE constraint on row_hash
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'target_master_row_hash_key'
    ) THEN
        ALTER TABLE public.target_master ADD CONSTRAINT target_master_row_hash_key UNIQUE (row_hash);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_master_row_hash ON public.target_master (row_hash);
