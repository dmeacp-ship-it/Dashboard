-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 20: Customer profile (bills, product range, project share)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates `vw_customer_profile_agg` and its snapshot `mv_customer_profile_agg`:
-- one row per customer with the number of distinct bills, the number of
-- product types bought, and how much of the volume was project sales. It backs
-- three classifications on Customer Health -> Customer Classification:
--   - Number of bills (including "One bill only")
--   - Product range (single product vs several)
--   - Retail vs project
--
-- WHY A NEW VIEW:
-- vw_customer_sale_agg has no bill number, product type or sales type, and
-- txn_count on vw_customer_summary counts line items, not bills.
--
-- UNTIL THIS IS RUN:
-- Those three classifications are listed as "(needs setup)" and cannot be
-- picked. Every other classification and the Follow-up List work without it.
--
-- NOTE:
-- These are attributes of the customer across all of their business, so they
-- do not change with the dashboard's HOD / zone filters.
--
-- FRESHNESS:
-- refresh_dashboard_views() (migration 18) refreshes every snapshot it finds,
-- so mv_customer_profile_agg is kept in step after each sync.
--
-- ACCESS:
-- Only the dashboard server reads these, with the service role key.
--
-- HOW TO RUN:
-- Supabase -> SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Then restart the dashboard server (it remembers a missing view until then).
-- ═══════════════════════════════════════════════════════════════════════════

drop materialized view if exists public.mv_customer_profile_agg;

create or replace view public.vw_customer_profile_agg as
select
  customer_code,
  count(distinct bill_number_sap)                                   as bill_count,
  count(distinct nullif(btrim(product_type), ''))                   as product_types,
  sum(case when sales_type = 'Projects' then total_sqm else 0 end)  as project_sqm,
  sum(total_sqm)                                                    as total_sqm
from public.sales_data
where customer_code is not null and btrim(customer_code) <> ''
group by customer_code;

create materialized view public.mv_customer_profile_agg as select * from public.vw_customer_profile_agg;
create index idx_mv_customer_profile_agg_code on public.mv_customer_profile_agg (customer_code);

revoke all on public.vw_customer_profile_agg, public.mv_customer_profile_agg from anon, authenticated;
grant select on public.vw_customer_profile_agg, public.mv_customer_profile_agg to service_role;
