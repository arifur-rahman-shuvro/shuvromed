-- M6: private workspace core (ShuvroMed v3.0, Phase 1).
-- ADDITIVE ONLY: creates new tables, functions, triggers and policies. It does not alter, rename, empty or
-- drop any existing table. The legacy tables (attempts, bookmarks, question_notes, flags, review_schedule,
-- study_sessions, subjects, topics, questions, ...) are not touched.
--
-- Ownership model: every table has owner_id = auth.uid() and unique (owner_id, id). Every link is a composite
-- foreign key (owner_id, x_id) -> (owner_id, id), so a row can only ever point at rows of the same owner,
-- whatever the client sends. RLS then limits every statement to the caller's own rows.
-- Rollback: supabase/rollback/20261108090600_private_workspace_core.down.sql

-- ---------------------------------------------------------------------------------------------------------
-- Helpers (pure, pinned search_path)
-- ---------------------------------------------------------------------------------------------------------

-- Case-insensitive, whitespace-normalised key used for "unique per owner" name rules.
create or replace function public.norm_name(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select lower(regexp_replace(btrim(t), '\s+', ' ', 'g')) $$;

-- Bumps the sync cursor on every update (updated_at) and the optimistic-concurrency counter (row_version).
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end;
$$;
revoke all on function public.touch_row() from public, anon, authenticated;

-- Scoring settings stored inside a question. Allowed keys depend on the type.
create or replace function public.valid_scoring(qtype text, s jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare k text;
begin
  if s is null then return true; end if;
  if jsonb_typeof(s) is distinct from 'object' then return false; end if;
  for k in select jsonb_object_keys(s) loop
    if qtype in ('SBA', 'TRUE_FALSE') then
      if k <> 'negative_marks' then return false; end if;
    elsif qtype = 'MULTIPLE_MCQ' then
      if k not in ('mode', 'penalty_weight', 'negative_marks') then return false; end if;
    elsif qtype = 'FILL_GAP' then
      if k <> 'mode' then return false; end if;
    else
      return false;
    end if;
  end loop;
  if s ? 'negative_marks' then
    if jsonb_typeof(s -> 'negative_marks') is distinct from 'number' then return false; end if;
    if (s ->> 'negative_marks')::numeric not between 0 and 1 then return false; end if;
  end if;
  if s ? 'penalty_weight' then
    if jsonb_typeof(s -> 'penalty_weight') is distinct from 'number' then return false; end if;
    if (s ->> 'penalty_weight')::numeric not between 0 and 5 then return false; end if;
  end if;
  if s ? 'mode' then
    if jsonb_typeof(s -> 'mode') is distinct from 'string' then return false; end if;
    if qtype = 'MULTIPLE_MCQ' and (s ->> 'mode') not in ('exact', 'partial') then return false; end if;
    if qtype = 'FILL_GAP' and (s ->> 'mode') not in ('partial', 'all_or_nothing') then return false; end if;
  end if;
  return true;
end;
$$;

-- The type-specific answer data of a question, per type. Mirrors the Zod schemas in the app (Phase 3).
create or replace function public.valid_question_payload(qtype text, stem text, c jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  o jsonb;
  b jsonb;
  v jsonb;
  ids text[] := '{}';
  texts text[] := '{}';
  seen text[] := '{}';
  i text;
  n int;
begin
  if c is null or jsonb_typeof(c) is distinct from 'object' then return false; end if;
  if not public.valid_scoring(qtype, c -> 'scoring') then return false; end if;

  if qtype in ('SBA', 'MULTIPLE_MCQ') then
    if qtype = 'SBA' then
      if (c - array['options', 'correct_option_id', 'scoring']) <> '{}'::jsonb then return false; end if;
    else
      if (c - array['options', 'correct_option_ids', 'scoring']) <> '{}'::jsonb then return false; end if;
    end if;
    o := c -> 'options';
    if jsonb_typeof(o) is distinct from 'array' then return false; end if;
    n := jsonb_array_length(o);
    if n < 2 or n > 12 then return false; end if;
    for b in select value from jsonb_array_elements(o) loop
      if jsonb_typeof(b) is distinct from 'object' then return false; end if;
      if (b - array['id', 'text', 'explanation']) <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then return false; end if;
      if jsonb_typeof(b -> 'text') is distinct from 'string' then return false; end if;
      i := b ->> 'id';
      if i !~ '^[A-Za-z0-9_-]{1,40}$' then return false; end if;
      if char_length(btrim(b ->> 'text')) not between 1 and 2000 then return false; end if;
      if b ? 'explanation' then
        if jsonb_typeof(b -> 'explanation') is distinct from 'string' then return false; end if;
        if char_length(b ->> 'explanation') > 4000 then return false; end if;
      end if;
      if i = any (ids) then return false; end if;
      if public.norm_name(b ->> 'text') = any (texts) then return false; end if; -- two identical options
      ids := ids || i;
      texts := texts || public.norm_name(b ->> 'text');
    end loop;

    if qtype = 'SBA' then
      if jsonb_typeof(c -> 'correct_option_id') is distinct from 'string' then return false; end if;
      return (c ->> 'correct_option_id') = any (ids);
    end if;

    v := c -> 'correct_option_ids';
    if jsonb_typeof(v) is distinct from 'array' then return false; end if;
    if jsonb_array_length(v) < 2 or jsonb_array_length(v) > n then return false; end if;
    for b in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(b) is distinct from 'string' then return false; end if;
      i := b #>> '{}';
      if not (i = any (ids)) or i = any (seen) then return false; end if;
      seen := seen || i;
    end loop;
    return true;

  elsif qtype = 'TRUE_FALSE' then
    if (c - array['correct_answer', 'scoring']) <> '{}'::jsonb then return false; end if;
    return jsonb_typeof(c -> 'correct_answer') = 'boolean';

  elsif qtype = 'FILL_GAP' then
    if (c - array['blanks', 'normalization', 'scoring']) <> '{}'::jsonb then return false; end if;
    if c ? 'normalization' then
      v := c -> 'normalization';
      if jsonb_typeof(v) is distinct from 'object' then return false; end if;
      if (v - array['case_sensitive', 'strip_punctuation']) <> '{}'::jsonb then return false; end if;
      if v ? 'case_sensitive' and jsonb_typeof(v -> 'case_sensitive') is distinct from 'boolean' then return false; end if;
      if v ? 'strip_punctuation' and jsonb_typeof(v -> 'strip_punctuation') is distinct from 'boolean' then return false; end if;
    end if;
    o := c -> 'blanks';
    if jsonb_typeof(o) is distinct from 'array' then return false; end if;
    n := jsonb_array_length(o);
    if n < 1 or n > 20 then return false; end if;
    for b in select value from jsonb_array_elements(o) loop
      if jsonb_typeof(b) is distinct from 'object' then return false; end if;
      if (b - array['id', 'accepted_answers', 'case_sensitive']) <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then return false; end if;
      i := b ->> 'id';
      if i !~ '^[A-Za-z0-9_-]{1,40}$' or i = any (ids) then return false; end if;
      if position(('{{' || i || '}}') in stem) = 0 then return false; end if; -- the stem must show where the blank goes
      ids := ids || i;
      if b ? 'case_sensitive' and jsonb_typeof(b -> 'case_sensitive') is distinct from 'boolean' then return false; end if;
      v := b -> 'accepted_answers';
      if jsonb_typeof(v) is distinct from 'array' then return false; end if;
      if jsonb_array_length(v) < 1 or jsonb_array_length(v) > 20 then return false; end if;
      for o in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(o) is distinct from 'string' then return false; end if;
        if char_length(btrim(o #>> '{}')) not between 1 and 200 then return false; end if;
      end loop;
    end loop;
    return true;
  end if;
  return false;
end;
$$;

-- Fingerprint of everything that, when changed, makes a new question version.
create or replace function public.question_content_hash(qtype text, stem text, content jsonb, expl text, ref text, diff text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_array(qtype, stem, content, expl, ref, diff)::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Classification: subjects, topics, tags
-- ---------------------------------------------------------------------------------------------------------

create table public.user_subjects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  name_key    text generated always as (public.norm_name(name)) stored,
  description text check (description is null or char_length(description) <= 500),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, name_key)
);

create table public.user_topics (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id  uuid not null,
  parent_id   uuid,
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  name_key    text generated always as (public.norm_name(name)) stored,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, subject_id) references public.user_subjects (owner_id, id),
  foreign key (owner_id, parent_id) references public.user_topics (owner_id, id),
  check (parent_id is distinct from id)
);
create unique index user_topics_name_uniq
  on public.user_topics (owner_id, subject_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name_key);
create index user_topics_subject_idx on public.user_topics (owner_id, subject_id);
create index user_topics_parent_idx on public.user_topics (owner_id, parent_id);

create table public.user_tags (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category    text not null check (category in ('exam', 'general')),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  name_key    text generated always as (public.norm_name(name)) stored,
  archived_at timestamptz,
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, category, name_key)
);

-- A topic's parent must be in the same subject, a topic never moves subject, and the tree has no cycles.
create or replace function public.user_topics_check_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  psub uuid;
  cyc boolean;
begin
  if tg_op = 'UPDATE' and new.subject_id <> old.subject_id then
    raise exception 'A topic cannot move to another subject' using errcode = '23514';
  end if;
  if new.parent_id is not null then
    select t.subject_id into psub from public.user_topics t where t.id = new.parent_id and t.owner_id = new.owner_id;
    if psub is null or psub <> new.subject_id then
      raise exception 'A parent topic must belong to the same subject' using errcode = '23514';
    end if;
    with recursive up (id, parent_id) as (
      select t.id, t.parent_id from public.user_topics t where t.id = new.parent_id and t.owner_id = new.owner_id
      union all
      select t.id, t.parent_id from public.user_topics t join up on t.id = up.parent_id and t.owner_id = new.owner_id
    )
    select exists (select 1 from up where up.id = new.id) into cyc;
    if cyc then
      raise exception 'That would make a topic its own ancestor' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.user_topics_check_tree() from public, anon, authenticated;
create trigger user_topics_tree before insert or update on public.user_topics
  for each row execute function public.user_topics_check_tree();

create trigger user_subjects_touch before update on public.user_subjects for each row execute function public.touch_row();
create trigger user_topics_touch before update on public.user_topics for each row execute function public.touch_row();
create trigger user_tags_touch before update on public.user_tags for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------------------------------------
-- Questions, versions, classification links
-- ---------------------------------------------------------------------------------------------------------

create table public.user_questions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id      uuid not null,
  question_type   text not null check (question_type in ('SBA', 'MULTIPLE_MCQ', 'TRUE_FALSE', 'FILL_GAP')),
  stem            text not null check (char_length(btrim(stem)) between 1 and 10000),
  difficulty      text check (difficulty in ('easy', 'medium', 'hard')),
  content         jsonb not null check (octet_length(content::text) <= 200000),
  explanation     text check (explanation is null or char_length(explanation) <= 20000),
  reference       text check (reference is null or char_length(reference) <= 2000),
  current_version integer not null default 1,
  content_hash    text,
  archived_at     timestamptz,
  deleted_at      timestamptz,
  row_version     integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, subject_id) references public.user_subjects (owner_id, id),
  constraint user_questions_payload_valid check (public.valid_question_payload(question_type, stem, content))
);
create index user_questions_subject_idx on public.user_questions (owner_id, subject_id);
create index user_questions_state_idx on public.user_questions (owner_id, archived_at, deleted_at);
create index user_questions_updated_idx on public.user_questions (owner_id, updated_at);

create table public.user_question_versions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  question_id   uuid not null,
  version       integer not null check (version >= 1),
  question_type text not null,
  stem          text not null,
  difficulty    text,
  content       jsonb not null,
  explanation   text,
  reference     text,
  subject_id    uuid not null,
  subject_name  text not null,
  content_hash  text not null,
  created_at    timestamptz not null default now(),
  unique (owner_id, question_id, version),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade
);

-- Sets the version number and fingerprint. The client can never choose them.
create or replace function public.user_questions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.content_hash := public.question_content_hash(new.question_type, new.stem, new.content, new.explanation, new.reference, new.difficulty);
  if tg_op = 'INSERT' then
    new.current_version := 1;
    new.row_version := 1;
  else
    if new.owner_id <> old.owner_id then
      raise exception 'owner_id cannot change' using errcode = '42501';
    end if;
    -- Classification-only edits (topics, tags, archive state) do not change the hash, so no new version.
    new.current_version := old.current_version + case when new.content_hash is distinct from old.content_hash then 1 else 0 end;
    new.row_version := old.row_version + 1;
    new.updated_at := now();
    if new.subject_id <> old.subject_id and exists (
      select 1
      from public.user_question_topics l
      join public.user_topics t on t.owner_id = l.owner_id and t.id = l.topic_id
      where l.owner_id = new.owner_id and l.question_id = new.id and t.subject_id <> new.subject_id
    ) then
      raise exception 'Remove this question''s topics before moving it to another subject' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.user_questions_before_write() from public, anon, authenticated;

-- Writes the immutable snapshot in the same transaction as the edit. SECURITY DEFINER because clients have no
-- INSERT privilege on versions at all: they cannot forge or skip a version.
create or replace function public.user_questions_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.current_version <> old.current_version then
    insert into public.user_question_versions
      (owner_id, question_id, version, question_type, stem, difficulty, content, explanation, reference, subject_id, subject_name, content_hash)
    select new.owner_id, new.id, new.current_version, new.question_type, new.stem, new.difficulty, new.content,
           new.explanation, new.reference, new.subject_id, s.name, new.content_hash
    from public.user_subjects s
    where s.id = new.subject_id and s.owner_id = new.owner_id;
  end if;
  return null;
end;
$$;
revoke all on function public.user_questions_after_write() from public, anon, authenticated;

create trigger user_questions_bw before insert or update on public.user_questions
  for each row execute function public.user_questions_before_write();
create trigger user_questions_aw after insert or update on public.user_questions
  for each row execute function public.user_questions_after_write();

create table public.user_question_topics (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null,
  topic_id    uuid not null,
  created_at  timestamptz not null default now(),
  primary key (question_id, topic_id),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade,
  foreign key (owner_id, topic_id) references public.user_topics (owner_id, id)
);
create index user_question_topics_topic_idx on public.user_question_topics (owner_id, topic_id);

create table public.user_question_tag_links (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null,
  tag_id      uuid not null,
  created_at  timestamptz not null default now(),
  primary key (question_id, tag_id),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade,
  -- Deleting a tag removes its links (the question itself is kept; with no exam tag it becomes Universal).
  foreign key (owner_id, tag_id) references public.user_tags (owner_id, id) on delete cascade
);
create index user_question_tag_links_tag_idx on public.user_question_tag_links (owner_id, tag_id);

-- A topic must belong to the question's own subject; bounded number of links per question.
create or replace function public.user_question_topics_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.user_questions q
    join public.user_topics t on t.owner_id = q.owner_id and t.subject_id = q.subject_id
    where q.id = new.question_id and q.owner_id = new.owner_id and t.id = new.topic_id
  ) then
    raise exception 'A topic can only be added to a question in the same subject' using errcode = '23514';
  end if;
  if (select count(*) from public.user_question_topics l where l.owner_id = new.owner_id and l.question_id = new.question_id) >= 30 then
    raise exception 'A question can have at most 30 topics' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.user_question_topics_check() from public, anon, authenticated;
create trigger user_question_topics_chk before insert on public.user_question_topics
  for each row execute function public.user_question_topics_check();

create or replace function public.user_question_tag_links_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.user_question_tag_links l where l.owner_id = new.owner_id and l.question_id = new.question_id) >= 60 then
    raise exception 'A question can have at most 60 tags' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.user_question_tag_links_check() from public, anon, authenticated;
create trigger user_question_tag_links_chk before insert on public.user_question_tag_links
  for each row execute function public.user_question_tag_links_check();

-- Changing a question's classification marks the question as changed (for sync) without making a new version.
create or replace function public.user_question_links_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  qid uuid := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  oid uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
begin
  if pg_trigger_depth() > 1 then return null; end if; -- part of a cascade (question or account removal): nothing to mark
  update public.user_questions set updated_at = now() where id = qid and owner_id = oid;
  return null;
end;
$$;
revoke all on function public.user_question_links_touch() from public, anon, authenticated;
create trigger user_question_topics_touch after insert or delete on public.user_question_topics
  for each row execute function public.user_question_links_touch();
create trigger user_question_tag_links_touch after insert or delete on public.user_question_tag_links
  for each row execute function public.user_question_links_touch();

-- ---------------------------------------------------------------------------------------------------------
-- Answers, bookmarks, notes, revision, reports
-- ---------------------------------------------------------------------------------------------------------

-- One recorded answer. Written once, never changed. It names the exact question version that was answered.
create table public.user_question_attempts (
  id               uuid primary key,
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id      uuid not null,
  question_version integer not null,
  response         jsonb not null check (octet_length(response::text) <= 20000),
  score            numeric(8, 4) not null check (score between -10 and 100),
  max_score        numeric(8, 4) not null check (max_score > 0 and max_score <= 100),
  outcome          text not null check (outcome in ('correct', 'partial', 'incorrect', 'unanswered')),
  confidence       smallint check (confidence between 1 and 5),
  time_ms          integer not null default 0 check (time_ms between 0 and 86400000),
  mode             text not null default 'practice' check (mode in ('practice', 'exam', 'revision')),
  session_id       uuid,
  exam_session_id  uuid, -- the foreign key is added with the exam tables (M9)
  attempted_at     timestamptz not null,
  created_at       timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, question_id, question_version)
    references public.user_question_versions (owner_id, question_id, version)
);
create index user_question_attempts_q_idx on public.user_question_attempts (owner_id, question_id, attempted_at);
create index user_question_attempts_time_idx on public.user_question_attempts (owner_id, attempted_at);
create index user_question_attempts_created_idx on public.user_question_attempts (owner_id, created_at);

create table public.user_bookmark_collections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  name_key    text generated always as (public.norm_name(name)) stored,
  row_version integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, name_key)
);
create trigger user_bookmark_collections_touch before update on public.user_bookmark_collections
  for each row execute function public.touch_row();

create table public.user_question_bookmarks (
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id   uuid not null,
  collection_id uuid,
  created_at    timestamptz not null default now(),
  primary key (owner_id, question_id),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade,
  -- Deleting a collection keeps its bookmarks (they become unfiled), as the legacy feature did.
  foreign key (owner_id, collection_id) references public.user_bookmark_collections (owner_id, id) on delete set null (collection_id)
);
create index user_question_bookmarks_coll_idx on public.user_question_bookmarks (owner_id, collection_id);

create table public.user_question_notes (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner_id, question_id),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade
);
create trigger user_question_notes_touch before update on public.user_question_notes
  for each row execute function public.set_updated_at();

-- Revision schedule: one row per question (what is due next) ...
create table public.user_question_reviews (
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id      uuid not null,
  due_at           timestamptz not null,
  interval_days    numeric(8, 2) not null default 0 check (interval_days >= 0),
  ease             numeric(4, 2) not null default 2.50 check (ease between 1.30 and 5.00),
  repetitions      integer not null default 0 check (repetitions >= 0),
  lapses           integer not null default 0 check (lapses >= 0),
  last_reviewed_at timestamptz,
  last_version     integer check (last_version is null or last_version >= 1),
  row_version      integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (owner_id, question_id),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade
);
create index user_question_reviews_due_idx on public.user_question_reviews (owner_id, due_at);
create trigger user_question_reviews_touch before update on public.user_question_reviews
  for each row execute function public.touch_row();

-- ... and a history of every review, stamped with the version that was reviewed.
create table public.user_question_review_log (
  id               uuid primary key,
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id      uuid not null,
  question_version integer not null,
  reviewed_at      timestamptz not null,
  outcome          text not null check (outcome in ('correct', 'partial', 'incorrect', 'manual')),
  interval_days    numeric(8, 2) not null check (interval_days >= 0),
  next_due_at      timestamptz not null,
  created_at       timestamptz not null default now(),
  foreign key (owner_id, question_id, question_version)
    references public.user_question_versions (owner_id, question_id, version)
);
create index user_question_review_log_q_idx on public.user_question_review_log (owner_id, question_id, reviewed_at);

-- The owner's own "this question needs attention" reports. Private: not visible to anyone else, admins included.
create table public.user_question_reports (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id      uuid not null,
  question_version integer,
  reason           text not null check (reason in ('incorrect', 'unclear', 'outdated', 'typo', 'other')),
  comment          text check (comment is null or char_length(comment) <= 1000),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  row_version      integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (owner_id, question_id, reason),
  foreign key (owner_id, question_id) references public.user_questions (owner_id, id) on delete cascade
);
create trigger user_question_reports_touch before update on public.user_question_reports
  for each row execute function public.touch_row();

-- ---------------------------------------------------------------------------------------------------------
-- Privileges and row level security
-- ---------------------------------------------------------------------------------------------------------

-- Supabase's default privileges would hand every new table to anon and authenticated. Take it all back first.
revoke all on table
  public.user_subjects, public.user_topics, public.user_tags, public.user_questions, public.user_question_versions,
  public.user_question_topics, public.user_question_tag_links, public.user_question_attempts,
  public.user_bookmark_collections, public.user_question_bookmarks, public.user_question_notes,
  public.user_question_reviews, public.user_question_review_log, public.user_question_reports
  from anon, authenticated;

-- Read, write and remove their own rows.
grant select, insert, update, delete on table
  public.user_subjects, public.user_topics, public.user_tags, public.user_questions,
  public.user_question_topics, public.user_question_tag_links,
  public.user_bookmark_collections, public.user_question_bookmarks, public.user_question_notes,
  public.user_question_reviews, public.user_question_reports
  to authenticated;
-- Append-only history: read and add, never change or remove through the API.
grant select, insert on table public.user_question_attempts, public.user_question_review_log to authenticated;
-- Versions are written only by the database trigger.
grant select on table public.user_question_versions to authenticated;

alter table public.user_subjects enable row level security;
alter table public.user_topics enable row level security;
alter table public.user_tags enable row level security;
alter table public.user_questions enable row level security;
alter table public.user_question_versions enable row level security;
alter table public.user_question_topics enable row level security;
alter table public.user_question_tag_links enable row level security;
alter table public.user_question_attempts enable row level security;
alter table public.user_bookmark_collections enable row level security;
alter table public.user_question_bookmarks enable row level security;
alter table public.user_question_notes enable row level security;
alter table public.user_question_reviews enable row level security;
alter table public.user_question_review_log enable row level security;
alter table public.user_question_reports enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_subjects', 'user_topics', 'user_tags', 'user_questions', 'user_question_topics', 'user_question_tag_links',
    'user_bookmark_collections', 'user_question_bookmarks', 'user_question_notes', 'user_question_reviews', 'user_question_reports'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
  foreach t in array array['user_question_attempts', 'user_question_review_log'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
  end loop;
end
$$;
create policy user_question_versions_select_own on public.user_question_versions for select to authenticated
  using (owner_id = (select auth.uid()));
