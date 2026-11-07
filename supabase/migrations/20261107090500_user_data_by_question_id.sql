-- ShuvroMed migration 5: let per-user data refer to questions by ID only.
--
-- Why: question content is shipped as static, versioned JSON files (not stored in the database), so
-- public.questions is empty and every upload of an attempt, bookmark, note, flag or review schedule
-- was rejected by its foreign key. Cross-device sync cannot work until those links are removed.
--
-- What changes: the five foreign keys from user-data tables to public.questions are dropped and replaced
-- by a length check so the id column stays bounded. Nothing else changes: RLS, grants and every other
-- constraint are untouched. Row level security still limits each user to their own rows.
-- Trade-off: a user can store an id for a question that no longer exists. The app ignores such ids.
--
-- Rollback (only if public.questions is populated with every referenced id):
--   alter table public.attempts add foreign key (question_id) references public.questions (id) on delete restrict;
--   (same for bookmarks, question_notes, flags, review_schedule), then drop the *_question_id_len checks.

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.questions'::regclass
      and c.conrelid in ('public.attempts'::regclass, 'public.bookmarks'::regclass,
                         'public.question_notes'::regclass, 'public.flags'::regclass,
                         'public.review_schedule'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$$;

alter table public.attempts        add constraint attempts_question_id_len        check (char_length(question_id) between 1 and 100);
alter table public.bookmarks       add constraint bookmarks_question_id_len       check (char_length(question_id) between 1 and 100);
alter table public.question_notes  add constraint question_notes_question_id_len  check (char_length(question_id) between 1 and 100);
alter table public.flags           add constraint flags_question_id_len           check (char_length(question_id) between 1 and 100);
alter table public.review_schedule add constraint review_schedule_question_id_len check (char_length(question_id) between 1 and 100);
