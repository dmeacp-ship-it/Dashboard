-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 16: Executive city lookup
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- Creates `vw_executive_city_agg`: sq ft per (sales person, city). The
-- dashboard loads it once and caches it for 10 minutes, then shows each
-- executive the city they sell most in as the City column on Executive Sales
-- (loadExecCities in src/services/data.service.js).
--
-- WHY A SEPARATE LOOKUP:
-- vw_executive_sale_agg has no city column, and adding one would multiply its
-- rows by the number of cities each person sells in. Target vs Sales pages
-- through that entire view on every load, so that would slow the dashboard
-- down for one label. This is the same approach as vw_hod_state (migration 08).
--
-- NOTE:
-- The city is an all-time label, like a base location. It does not change with
-- the dashboard's FY / quarter / month filters.
--
-- ACCESS:
-- Only the dashboard server reads this, with the service role key. anon and
-- authenticated get nothing, matching db/migrations/03.
--
-- HOW TO RUN:
-- Paste into the Supabase SQL Editor and Run. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.vw_executive_city_agg as
select
  upper(btrim(sales_person)) as sales_person,
  upper(btrim(city))         as city,
  sum(sq_ft)                 as sq_ft
from public.sales_data
where sales_person is not null and btrim(sales_person) <> ''
  and city is not null and btrim(city) <> ''
group by 1, 2;

revoke all on public.vw_executive_city_agg from anon, authenticated;
grant select on public.vw_executive_city_agg to service_role;
