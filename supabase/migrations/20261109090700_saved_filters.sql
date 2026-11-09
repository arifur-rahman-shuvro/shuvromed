-- M7: saved filters for the question bank (Phase 7). Additive only: one new table, one function, one trigger.
-- It does not touch any existing table, row, policy or function.
-- Rollback: supabase/rollback/20261109090700_saved_filters.down.sql   Verify: supabase/verify/m7_verify.sql

create table public.user_saved_filters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  name_key    text generated always as (public.norm_name(name)) stored,
  -- The app's own description of the filter (text, subjects, tags...). Only its size and shape are checked here;
  -- the app reads it defensively, so a filter saved by a newer app version never breaks an older one.
  filter      jsonb not null check (jsonb_typeof(filter) = 'object' and octet_length(filter::text) <= 20000),
  sort        text not null default 'edited-new' check (sort in ('edited-new', 'edited-old', 'wording')),
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, name_key)
);

create trigger user_saved_filters_touch before update on public.user_saved_filters for each row execute function public.touch_row();

-- At most 100 saved filters per person, so the free database cannot be filled through this table.
create or replace function public.user_saved_filters_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.user_saved_filters where owner_id = new.owner_id) >= 100 then
    raise exception 'You can keep at most 100 saved filters' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.user_saved_filters_cap() from public, anon, authenticated;
create trigger user_saved_filters_cap before insert on public.user_saved_filters for each row execute function public.user_saved_filters_cap();

-- Same privilege and security rules as the other private tables: nothing for anon, own rows only for signed-in users.
revoke all on table public.user_saved_filters from anon, authenticated;
grant select, insert, update, delete on table public.user_saved_filters to authenticated;
alter table public.user_saved_filters enable row level security;
create policy user_saved_filters_select_own on public.user_saved_filters for select to authenticated using (owner_id = (select auth.uid()));
create policy user_saved_filters_insert_own on public.user_saved_filters for insert to authenticated with check (owner_id = (select auth.uid()));
create policy user_saved_filters_update_own on public.user_saved_filters for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy user_saved_filters_delete_own on public.user_saved_filters for delete to authenticated using (owner_id = (select auth.uid()));
