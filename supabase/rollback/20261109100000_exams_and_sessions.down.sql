-- Rollback for M8. Removes ONLY what M8 created and puts the attempts table back as M6 left it.
-- WARNING: deletes saved exams and sessions. Attempts rows are kept (their session_id simply stops pointing at a session).
begin;
alter table public.user_question_attempts drop constraint if exists user_question_attempts_session_fk;
drop index if exists public.user_question_attempts_session_idx;
drop table if exists public.user_sessions cascade;
drop table if exists public.user_exams cascade;
drop function if exists public.user_sessions_guard();
commit;
