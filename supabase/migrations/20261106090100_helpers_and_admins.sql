-- ShuvroMed migration 1/4: shared helpers and the admin allow-list.
-- Conventions: every table has RLS enabled; every function pins search_path.

-- Keeps updated_at honest regardless of what the client sends.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Admin allow-list. Owner adds their own user id with the service role / SQL editor.
-- RLS is on and NO policy exists, so API roles can never read or write this table.
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

-- SECURITY DEFINER so policies can ask "is the caller an admin?" without
-- the caller being able to read public.admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;
