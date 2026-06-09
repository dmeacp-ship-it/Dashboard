-- ============================================================
--  Dashboard login/users table
--  Run this once in Supabase → SQL Editor.
--  Roles: super_admin | admin | hod | zonal_head
--  - hod   users are scoped to one or MORE hod_name values (allowed_hods)
--  - zonal_head users are scoped to one or more zones (allowed_zones)
-- ============================================================

create table if not exists public.dashboard_users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  full_name     text,
  role          text not null default 'hod',
  allowed_hods  text[] not null default '{}',
  allowed_zones text[] not null default '{}',
  is_active     boolean not null default true,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- The dashboard server is the ONLY client of this table (the Supabase key is
-- never exposed to the browser — the UI talks to /api, not Supabase directly).
-- So disable RLS, otherwise the server key can't read/write the users.
alter table public.dashboard_users disable row level security;

-- Seed the first Super Admin.
--   username: superadmin
--   password: Virgo@2025   (change it after first login)
insert into public.dashboard_users (username, full_name, role, password_hash)
values (
  'superadmin',
  'Super Admin',
  'super_admin',
  'ce54155a7da94d09$b9c5a80c84f21fcec8b046bcb6fa319a1ecbfa879f8cb5be6e3cc999f8a941f0'
)
on conflict (username) do nothing;
