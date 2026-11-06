-- ShuvroMed migration 4/4: account lifecycle and backup bookkeeping.

-- New auth user -> profile + preferences. Must never raise, or sign-up would fail.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80)), '')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Account deletion. Deleting the auth user cascades to every user-owned row.
-- Only deletes the caller's own account; there is no user_id parameter to abuse.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Backup bookkeeping. Written ONLY by the backup job (service role); read by admins.
-- The constraints make a fake "success" row impossible: success needs a size,
-- a SHA-256 checksum, a destination and a finish time.
create table public.backup_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'success', 'failed')),
  destination   text check (char_length(destination) <= 300),
  size_bytes    bigint check (size_bytes > 0),
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at   timestamptz,
  verification_note text check (char_length(verification_note) <= 1000),
  error_message text check (char_length(error_message) <= 2000),
  created_at    timestamptz not null default now(),
  constraint finished_when_not_running check (status = 'running' or finished_at is not null),
  constraint success_has_evidence check (
    status <> 'success'
    or (size_bytes is not null and sha256 is not null and destination is not null)
  )
);
create index backup_runs_started_idx on public.backup_runs (started_at desc);

alter table public.backup_runs enable row level security;
revoke all on table public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;
create policy backup_runs_admin_read on public.backup_runs for select to authenticated
  using ((select public.is_admin()));
