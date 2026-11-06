-- LOCAL TEST SHIM ONLY. Never applied to a real Supabase project.
-- Recreates the small part of Supabase that our migrations depend on, so the
-- migrations and RLS policies can run on a plain PostgreSQL server:
--   roles anon / authenticated / service_role, the auth schema (auth.users,
--   auth.uid()) and Supabase's default table privileges for API roles.
-- Real GoTrue behaviour (password hashing, JWT issuing, email) is NOT emulated.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Same logic as Supabase's auth.uid(): read the sub claim of the request JWT.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase gives API roles ALL on new public tables/functions by default; mirror
-- that so our explicit REVOKE/GRANT statements are what actually protect the data.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
