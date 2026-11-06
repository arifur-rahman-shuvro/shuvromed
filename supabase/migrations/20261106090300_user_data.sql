-- ShuvroMed migration 3/4: per-user data with strict row level security.
-- Rule: a signed-in user can only ever see or change rows where user_id = their own id.
-- anon (signed-out) has NO access to any table in this file.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_preferences (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  theme                text not null default 'system' check (theme in ('light', 'dark', 'system')),
  daily_goal           integer not null default 20 check (daily_goal between 1 and 500),
  gamification_enabled boolean not null default true,
  language             text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  srs_config           jsonb not null default '{}'::jsonb check (jsonb_typeof(srs_config) = 'object'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.study_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind               text not null check (kind in ('practice', 'mock', 'revision')),
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  questions_answered integer not null default 0 check (questions_answered >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, id),
  check (ended_at is null or ended_at >= started_at)
);
create index study_sessions_user_started_idx on public.study_sessions (user_id, started_at desc);

-- Append-only log. The client supplies the id, so a retried upload of the same
-- attempt is rejected by the primary key instead of being counted twice.
create table public.attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id     text not null references public.questions (id) on delete restrict,
  session_id      uuid,
  selected_option text not null check (selected_option in ('A', 'B', 'C', 'D', 'E')),
  is_correct      boolean not null,
  confidence      smallint check (confidence between 1 and 5),
  time_ms         integer not null default 0 check (time_ms between 0 and 3600000),
  mode            text not null default 'practice' check (mode in ('practice', 'mock', 'revision')),
  attempted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  foreign key (user_id, session_id) references public.study_sessions (user_id, id)
    on delete set null (session_id)
);
create index attempts_user_time_idx on public.attempts (user_id, attempted_at desc);
create index attempts_user_question_idx on public.attempts (user_id, question_id);

create table public.bookmark_collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, name)
);

-- The composite FK makes it impossible to file a bookmark into another user's collection.
create table public.bookmarks (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id   text not null references public.questions (id) on delete restrict,
  collection_id uuid,
  created_at    timestamptz not null default now(),
  primary key (user_id, question_id),
  foreign key (user_id, collection_id) references public.bookmark_collections (user_id, id)
    on delete set null (collection_id)
);

create table public.question_notes (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete restrict,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id text not null references public.questions (id) on delete restrict,
  reason      text not null check (reason in ('incorrect', 'unclear', 'outdated', 'typo', 'other')),
  comment     text check (char_length(comment) <= 1000),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, question_id, reason)
);
create index flags_status_idx on public.flags (status);

create table public.review_schedule (
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id      text not null references public.questions (id) on delete restrict,
  due_at           timestamptz not null,
  interval_days    numeric(8, 2) not null default 0 check (interval_days >= 0),
  ease             numeric(4, 2) not null default 2.50 check (ease between 1.30 and 5.00),
  repetitions      integer not null default 0 check (repetitions >= 0),
  lapses           integer not null default 0 check (lapses >= 0),
  last_reviewed_at timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index review_schedule_due_idx on public.review_schedule (user_id, due_at);

create table public.user_achievements (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  achievement_id text not null check (char_length(achievement_id) between 1 and 80),
  earned_at      timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger user_preferences_updated before update on public.user_preferences
  for each row execute function public.set_updated_at();
create trigger study_sessions_updated before update on public.study_sessions
  for each row execute function public.set_updated_at();
create trigger question_notes_updated before update on public.question_notes
  for each row execute function public.set_updated_at();
create trigger flags_updated before update on public.flags
  for each row execute function public.set_updated_at();
create trigger review_schedule_updated before update on public.review_schedule
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.study_sessions enable row level security;
alter table public.attempts enable row level security;
alter table public.bookmark_collections enable row level security;
alter table public.bookmarks enable row level security;
alter table public.question_notes enable row level security;
alter table public.flags enable row level security;
alter table public.review_schedule enable row level security;
alter table public.user_achievements enable row level security;

-- Supabase grants broad default privileges to API roles; start from nothing.
revoke all on table
  public.profiles, public.user_preferences, public.study_sessions, public.attempts,
  public.bookmark_collections, public.bookmarks, public.question_notes, public.flags,
  public.review_schedule, public.user_achievements
from anon, authenticated;

-- Minimal grants. No UPDATE on attempts or achievements; no INSERT on profiles
-- (created by trigger); no DELETE on profiles/preferences (removed by account deletion).
grant select, update on public.profiles, public.user_preferences to authenticated;
grant select, insert, update, delete
  on public.study_sessions, public.bookmark_collections, public.bookmarks,
     public.question_notes, public.review_schedule
  to authenticated;
grant select, insert on public.attempts, public.user_achievements to authenticated;
grant select, insert, delete on public.flags to authenticated;
grant update (status) on public.flags to authenticated;  -- narrowed to admins by policy

-- profiles / user_preferences: own row only, and the key can never be reassigned.
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy prefs_select_own on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy prefs_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Tables with full owner CRUD.
do $$
declare t text;
begin
  foreach t in array array['study_sessions', 'bookmark_collections', 'bookmarks',
                           'question_notes', 'review_schedule']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end
$$;

-- Append-only tables: read and insert own rows, nothing else.
create policy attempts_select_own on public.attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy attempts_insert_own on public.attempts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy achievements_select_own on public.user_achievements for select to authenticated
  using (user_id = (select auth.uid()));
create policy achievements_insert_own on public.user_achievements for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Flags: users manage their own open reports; admins can read all and resolve them.
create policy flags_select on public.flags for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy flags_insert_own on public.flags for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');
create policy flags_delete_own on public.flags for delete to authenticated
  using (user_id = (select auth.uid()));
create policy flags_admin_update on public.flags for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
