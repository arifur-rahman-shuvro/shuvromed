-- M8: practice and exam sessions (Phase 8). Additive: two new tables, two functions, and ONE foreign key on the
-- (still empty) attempts table. No existing row, policy or function is changed.
-- Rollback: supabase/rollback/20261109100000_exams_and_sessions.down.sql   Verify: supabase/verify/m8_verify.sql
--
-- Answers are NOT a new table: every answer is a row in user_question_attempts (M6), which already stores the response,
-- score, outcome, time and the question VERSION that was answered. A session ties those rows together.

-- A saved exam set-up that can be started again and again (question source, count, time limit, marking).
create table public.user_exams (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  name_key    text generated always as (public.norm_name(name)) stored,
  -- The app's own description of the set-up. Only its shape and size are checked here; the app reads it defensively.
  config      jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 20000),
  archived_at timestamptz,
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, name_key)
);
create trigger user_exams_touch before update on public.user_exams for each row execute function public.touch_row();

-- One practice run or one exam attempt. The questions asked are fixed when it starts (question_ids), so changing the bank
-- later never changes what a past session contained.
create table public.user_sessions (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind               text not null check (kind in ('practice', 'exam')),
  exam_id            uuid,
  title              text not null check (char_length(btrim(title)) between 1 and 120),
  config             jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 20000),
  question_ids       jsonb not null check (jsonb_typeof(question_ids) = 'array' and jsonb_array_length(question_ids) between 1 and 500 and octet_length(question_ids::text) <= 40000),
  -- Progress while running (current position, flags, the answers of an exam not yet submitted). The app reads it defensively.
  state              jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 200000),
  status             text not null default 'in_progress' check (status in ('in_progress', 'finished', 'abandoned')),
  started_at         timestamptz not null,
  finished_at        timestamptz,
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 60 and 86400),
  elapsed_ms         integer not null default 0 check (elapsed_ms between 0 and 172800000),
  score              numeric(8, 4) check (score is null or score between -500 and 500),
  max_score          numeric(8, 4) check (max_score is null or (max_score > 0 and max_score <= 500)),
  correct            integer check (correct is null or correct between 0 and 500),
  incorrect          integer check (incorrect is null or incorrect between 0 and 500),
  partial            integer check (partial is null or partial between 0 and 500),
  unanswered         integer check (unanswered is null or unanswered between 0 and 500),
  -- History is never deleted (like attempts); a person hides a session from the list instead.
  hidden_at          timestamptz,
  row_version        integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_id, id),
  -- Removing a saved exam keeps the sessions that were run from it.
  foreign key (owner_id, exam_id) references public.user_exams (owner_id, id) on delete set null (exam_id),
  constraint user_sessions_finished_has_result check (
    status <> 'finished'
    or (finished_at is not null and score is not null and max_score is not null and correct is not null and incorrect is not null and partial is not null and unanswered is not null)
  )
);
create index user_sessions_updated_idx on public.user_sessions (owner_id, updated_at);
create index user_sessions_started_idx on public.user_sessions (owner_id, started_at);

-- A finished session is a record: its questions, settings and result can no longer be changed (only its title, its
-- hidden flag and its saved view state). A device that was offline and still holds an old copy cannot overwrite the result.
create or replace function public.user_sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'owner cannot change' using errcode = '23514';
  end if;
  if old.status = 'finished' and (
       new.status <> 'finished' or new.kind <> old.kind or new.config is distinct from old.config
    or new.question_ids is distinct from old.question_ids or new.started_at <> old.started_at
    or new.finished_at is distinct from old.finished_at or new.score is distinct from old.score
    or new.max_score is distinct from old.max_score or new.correct is distinct from old.correct
    or new.incorrect is distinct from old.incorrect or new.partial is distinct from old.partial
    or new.unanswered is distinct from old.unanswered or new.elapsed_ms <> old.elapsed_ms
    or new.exam_id is distinct from old.exam_id and old.exam_id is not null and new.exam_id is not null
  ) then
    raise exception 'A finished session cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.user_sessions_guard() from public, anon, authenticated;
create trigger user_sessions_guard before update on public.user_sessions for each row execute function public.user_sessions_guard();
create trigger user_sessions_touch before update on public.user_sessions for each row execute function public.touch_row();

-- Attempts now point at their session. The attempts table is empty at this point, so the constraint cannot fail.
-- exam_session_id (reserved in M6) is not used: an exam attempt is a session of kind 'exam'.
alter table public.user_question_attempts
  add constraint user_question_attempts_session_fk
  foreign key (owner_id, session_id) references public.user_sessions (owner_id, id);
create index user_question_attempts_session_idx on public.user_question_attempts (owner_id, session_id);

-- Same privilege and security rules as the other private tables.
revoke all on table public.user_exams, public.user_sessions from anon, authenticated;
grant select, insert, update, delete on table public.user_exams to authenticated;
grant select, insert, update on table public.user_sessions to authenticated; -- no delete: history is kept
alter table public.user_exams enable row level security;
alter table public.user_sessions enable row level security;

create policy user_exams_select_own on public.user_exams for select to authenticated using (owner_id = (select auth.uid()));
create policy user_exams_insert_own on public.user_exams for insert to authenticated with check (owner_id = (select auth.uid()));
create policy user_exams_update_own on public.user_exams for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy user_exams_delete_own on public.user_exams for delete to authenticated using (owner_id = (select auth.uid()));
create policy user_sessions_select_own on public.user_sessions for select to authenticated using (owner_id = (select auth.uid()));
create policy user_sessions_insert_own on public.user_sessions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy user_sessions_update_own on public.user_sessions for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
