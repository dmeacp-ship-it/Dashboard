-- ============================================================================
--  EMERGENCY ROLLBACK — undoes 03_revoke_public_access.sql
--
--  USE THIS ONLY IF you need the dashboard working again right now and cannot
--  get the service_role key yet.
--
--  ⚠️  THIS PUTS THE SECURITY HOLE BACK.
--  It re-opens your full customer, revenue and outstanding data to anyone
--  holding the (publicly-designed) anon key. Treat it as a temporary measure:
--  finish 02_switch_to_service_role_key.md, then re-run 03.
--
--  The correct fix is almost always faster than this: copy the service_role key
--  from Supabase -> Project Settings -> API into SUPABASE_KEY in .env, and
--  restart. Try that first.
--
--  Where: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================================

begin;

-- Undo the default-privilege changes first, so anything created later behaves
-- the way it did before.
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Materialized views
do $$
declare v text;
begin
  foreach v in array array[
    'mv_monthly_agg', 'mv_hod_agg', 'mv_customer_sale_agg', 'mv_sku_type_sale_agg',
    'mv_brand_agg', 'mv_sku_agg', 'mv_filter_options', 'mv_customer_summary',
    'mv_sku_meta'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('grant select on public.%I to anon, authenticated', v);
    end if;
  end loop;
end $$;

-- Plain views
do $$
declare v record;
begin
  for v in
    select table_name from information_schema.views
    where table_schema = 'public' and table_name like 'vw\_%'
  loop
    execute format('grant select on public.%I to anon, authenticated', v.table_name);
  end loop;
end $$;

-- Base tables
do $$
declare t text;
begin
  foreach t in array array[
    'sales_data', 'outstanding_master', 'target_master',
    'dashboard_users', 'user_profiles', 'app_settings'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to anon, authenticated', t);
    end if;
  end loop;
end $$;

-- Functions
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'refresh_dashboard_views', 'api_top_skus', 'api_size_agg',
        'get_filter_options', 'get_enterprise_kpis', 'get_db_row_count',
        '_set_updated_at'
      )
  loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

commit;

-- ============================================================================
--  Dashboard should work again. The exposure is back — please finish the key
--  swap (file 02) and re-run file 03 as soon as you can.
--
--  NOTE: this restores SELECT, which is what the dashboard reads with. The
--  original grants included some broader privileges; this deliberately does not
--  restore write access that the app never used.
-- ============================================================================
