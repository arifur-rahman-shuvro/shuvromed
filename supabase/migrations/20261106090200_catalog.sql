-- ShuvroMed migration 2/4: content catalogue (public metadata only).
-- Question TEXT lives in versioned JSON in the repo. The database keeps only
-- metadata so user data can reference questions and stay inside the free 500 MB.

create table public.subjects (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name       text not null check (char_length(name) between 1 and 120),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topics (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  subject_id text not null references public.subjects (id) on delete restrict,
  parent_id  text references public.topics (id) on delete restrict,
  name       text not null check (char_length(name) between 1 and 160),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create index topics_subject_idx on public.topics (subject_id);
create index topics_parent_idx on public.topics (parent_id);

create table public.questions (
  id           text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$'),
  version      integer not null default 1 check (version >= 1),
  status       text not null default 'draft'
               check (status in ('draft', 'needs_review', 'approved', 'published', 'archived')),
  subject_id   text not null references public.subjects (id) on delete restrict,
  topic_id     text not null references public.topics (id) on delete restrict,
  difficulty   text not null check (difficulty in ('easy', 'medium', 'hard')),
  format       text not null check (char_length(format) between 1 and 40),
  exam_tags    text[] not null default '{}',
  -- AI-written or otherwise unreviewed content must never be published.
  unreviewed   boolean not null default true,
  content_hash text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint published_requires_review check (status <> 'published' or unreviewed = false)
);
create index questions_topic_idx on public.questions (topic_id);
create index questions_subject_idx on public.questions (subject_id);
create index questions_status_idx on public.questions (status);

create table public.question_revisions (
  id           bigint generated always as identity primary key,
  question_id  text not null references public.questions (id) on delete cascade,
  version      integer not null check (version >= 1),
  changed_by   uuid references auth.users (id) on delete set null,
  change_note  text check (char_length(change_note) <= 1000),
  content_hash text,
  created_at   timestamptz not null default now(),
  unique (question_id, version)
);

create trigger subjects_updated before update on public.subjects
  for each row execute function public.set_updated_at();
create trigger topics_updated before update on public.topics
  for each row execute function public.set_updated_at();
create trigger questions_updated before update on public.questions
  for each row execute function public.set_updated_at();

-- RLS: everyone may read active catalogue rows; only admins may write.
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.question_revisions enable row level security;

revoke all on table public.subjects, public.topics, public.questions, public.question_revisions
  from anon, authenticated;
grant select on public.subjects, public.topics, public.questions to anon, authenticated;
grant insert, update, delete on public.subjects, public.topics, public.questions to authenticated;
grant select, insert, update, delete on public.question_revisions to authenticated;

create policy subjects_read on public.subjects for select
  using (is_active or (select public.is_admin()));
create policy subjects_admin_write on public.subjects for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy topics_read on public.topics for select
  using (is_active or (select public.is_admin()));
create policy topics_admin_write on public.topics for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Students and visitors only ever see Published questions.
create policy questions_read on public.questions for select
  using (status = 'published' or (select public.is_admin()));
create policy questions_admin_write on public.questions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy question_revisions_admin on public.question_revisions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
