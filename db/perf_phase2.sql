-- ═══════════════════════════════════════════════════════════════════════════
-- Performance phase 2: customer-summary snapshot + DB-side GROUP BY RPCs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Prerequisite: db/perf_materialized_views.sql must already be applied
-- (this file references mv_sku_agg and redefines refresh_dashboard_views()).
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL editor and run it.
-- The backend auto-detects these relations/functions and uses them when
-- present, falling back to the previous behavior otherwise.
--
-- WHAT IT DOES:
-- 1. mv_customer_summary — snapshot of vw_customer_summary, which recomputes
--    per-customer aggregates from the raw sales table on every request and
--    dominates getKPIs (~6s). NOTE: days_since_last_purchase and the 6-month
--    windows are frozen at refresh time; they move again on every data sync
--    (refresh_dashboard_views runs after each sync), so staleness is bounded
--    by the sync cadence.
-- 2. api_top_skus / api_size_agg — GROUP BY in Postgres for the two endpoints
--    that otherwise download all ~48K mv_sku_agg rows to aggregate in Node.
--    They return jsonb (a single value) on purpose: PostgREST's max-rows cap
--    does not apply, so no pagination is needed.

-- ── Customer summary snapshot ────────────────────────────────────────────────
drop materialized view if exists mv_customer_summary;
create materialized view mv_customer_summary as select * from vw_customer_summary;
create index idx_mv_customer_summary_geo on mv_customer_summary (state, hod_name);

-- ~11% of item_codes (529/4646, verified live) have inconsistent
-- brand/finish/description across their rows (source data drift, e.g. label
-- revisions over time). A canonical label is resolved ONCE here at refresh
-- time via DISTINCT ON, rather than per query: running that sort against a
-- ~48K-row filtered set on every request (even indexed) was observed live to
-- run 60-90s on an unfiltered call — order-of-magnitude too slow, and past
-- Vercel's 60s function limit. This lookup is tiny (one row per item_code)
-- and joins by primary key, so per-query cost stays a cheap GROUP BY + join.
-- coalesce(item_code,'Unknown'): mv_sku_agg has ~23 rows (~69K sq_ft,
-- verified live) with a null item_code. `JOIN ... USING (item_code)` never
-- matches NULL = NULL, so those rows would silently vanish from every
-- api_top_skus result; the legacy JS path kept them under an 'Unknown' key
-- (_s(r,'item_code') || 'Unknown'). Coalescing here and in api_top_skus's
-- GROUP BY keeps both sides on the same key so the join preserves that data.
drop materialized view if exists mv_sku_meta;
create materialized view mv_sku_meta as
  select distinct on (item_code) item_code, item_description, brand, finish, size, sku_type
  from (select coalesce(item_code, 'Unknown') as item_code, item_description, brand, finish, size, sku_type from mv_sku_agg) x
  order by item_code, item_description, brand, finish, size, sku_type;
create unique index idx_mv_sku_meta_code on mv_sku_meta (item_code);

-- ── Refresh hook: now refreshes all snapshots (order matters: mv_sku_meta
-- reads from mv_sku_agg, so it must refresh after it) ───────────────────────
drop function if exists refresh_dashboard_views();
create function refresh_dashboard_views()
returns void language plpgsql security definer as $$
begin
  refresh materialized view mv_monthly_agg;
  refresh materialized view mv_hod_agg;
  refresh materialized view mv_customer_sale_agg;
  refresh materialized view mv_sku_type_sale_agg;
  refresh materialized view mv_brand_agg;
  refresh materialized view mv_sku_agg;
  refresh materialized view mv_filter_options;
  refresh materialized view mv_customer_summary;
  refresh materialized view mv_sku_meta;
end;
$$;

-- ── Shared filter contract for the RPCs ─────────────────────────────────────
-- p_fy:      exact fy_year values, e.g. {FY-24-25}
-- p_q:       quarter suffixes matched with LIKE, e.g. {Q-1,Q-2}
-- p_fyq_*:   zipped fy+quarter-suffix pairs for combined filters
--            (plain and paired quarter conditions are ORed, mirroring the
--            frontend's mixed-selection semantics)
-- p_zone/p_state/p_hod:    user-selected filters
-- p_zone2/p_state2/p_hod2: role-scope restrictions (ANDed with the above)
-- p_brand/p_sku_type:      case-insensitive exact matches (ILIKE, no wildcard)

-- Display labels come from mv_sku_meta (one canonical row per item_code,
-- resolved once at refresh time above) rather than from the filtered rows
-- themselves, so a brand/finish/description never gets Frankensteined from
-- mismatched rows. Filtering (including p_brand/p_sku_type) still applies to
-- the actual per-row values in mv_sku_agg, matching the original semantics.
drop function if exists api_top_skus(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text,text);
create function api_top_skus(
  p_fy text[] default null, p_q text[] default null,
  p_fyq_fy text[] default null, p_fyq_q text[] default null,
  p_zone text[] default null, p_state text[] default null, p_hod text[] default null,
  p_zone2 text[] default null, p_state2 text[] default null, p_hod2 text[] default null,
  p_brand text default null, p_sku_type text default null
) returns jsonb language sql security definer stable as $$
  with sums as (
    select coalesce(item_code, 'Unknown') as item_code,
           sum(total_sqm) as total_sqm, sum(sq_ft) as sq_ft,
           sum(quantity) as quantity, sum(txn_count) as txn_count
    from mv_sku_agg m
    where (p_fy is null or m.fy_year = any(p_fy))
      and ( (p_q is null and p_fyq_fy is null)
            or (p_q is not null and exists (select 1 from unnest(p_q) s where m.quarter like '%' || s))
            or (p_fyq_fy is not null and exists (
                  select 1 from unnest(p_fyq_fy, p_fyq_q) z(f, s)
                  where m.fy_year = z.f and m.quarter like '%' || s)) )
      and (p_zone   is null or m.zone = any(p_zone))
      and (p_state  is null or m.state = any(p_state))
      and (p_hod    is null or m.hod_name = any(p_hod))
      and (p_zone2  is null or m.zone = any(p_zone2))
      and (p_state2 is null or m.state = any(p_state2))
      and (p_hod2   is null or m.hod_name = any(p_hod2))
      and (p_brand    is null or m.brand ilike p_brand)
      and (p_sku_type is null or m.sku_type ilike p_sku_type)
    group by coalesce(item_code, 'Unknown')
  )
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select s.item_code, mm.item_description, mm.brand, mm.finish, mm.size, mm.sku_type,
           s.total_sqm, s.sq_ft, s.quantity, s.txn_count
    from sums s join mv_sku_meta mm using (item_code)
  ) t
$$;

drop function if exists api_size_agg(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[]);
create function api_size_agg(
  p_fy text[] default null, p_q text[] default null,
  p_fyq_fy text[] default null, p_fyq_q text[] default null,
  p_zone text[] default null, p_state text[] default null, p_hod text[] default null,
  p_zone2 text[] default null, p_state2 text[] default null, p_hod2 text[] default null
) returns jsonb language sql security definer stable as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select size,
           sum(total_sqm) as total_sqm, sum(sq_ft) as sq_ft,
           sum(quantity) as quantity, sum(txn_count) as txn_count
    from mv_sku_agg m
    where (p_fy is null or m.fy_year = any(p_fy))
      and ( (p_q is null and p_fyq_fy is null)
            or (p_q is not null and exists (select 1 from unnest(p_q) s where m.quarter like '%' || s))
            or (p_fyq_fy is not null and exists (
                  select 1 from unnest(p_fyq_fy, p_fyq_q) z(f, s)
                  where m.fy_year = z.f and m.quarter like '%' || s)) )
      and (p_zone   is null or m.zone = any(p_zone))
      and (p_state  is null or m.state = any(p_state))
      and (p_hod    is null or m.hod_name = any(p_hod))
      and (p_zone2  is null or m.zone = any(p_zone2))
      and (p_state2 is null or m.state = any(p_state2))
      and (p_hod2   is null or m.hod_name = any(p_hod2))
    group by size
  ) t
$$;

-- ── API access ───────────────────────────────────────────────────────────────
grant select on mv_customer_summary, mv_sku_meta to anon, authenticated, service_role;
grant execute on function refresh_dashboard_views() to anon, authenticated, service_role;
grant execute on function api_top_skus(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text,text)
  to anon, authenticated, service_role;
grant execute on function api_size_agg(text[],text[],text[],text[],text[],text[],text[],text[],text[],text[])
  to anon, authenticated, service_role;
