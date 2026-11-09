-- Run AFTER applying M8. Read-only. Expected results are in the comments.
select 'new tables (expect 2)' as check, count(*) from pg_tables where schemaname='public' and tablename in ('user_exams','user_sessions');
select 'RLS on (expect 2)', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('user_exams','user_sessions') and c.relrowsecurity;
select 'policies (expect 4 exams + 3 sessions = 7)', count(*) from pg_policies where schemaname='public' and tablename in ('user_exams','user_sessions');
select 'anon grants (expect 0)', count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('user_exams','user_sessions') and grantee='anon';
select 'sessions delete privilege for signed-in users (expect 0)', count(*) from information_schema.role_table_grants where table_schema='public' and table_name='user_sessions' and grantee='authenticated' and privilege_type='DELETE';
select 'attempts -> session foreign key (expect 1)', count(*) from pg_constraint where conname='user_question_attempts_session_fk';
select 'rows in new tables (expect 0)', (select count(*) from public.user_exams)+(select count(*) from public.user_sessions);
select 'attempts (expect 0, unchanged)', count(*) from public.user_question_attempts;
select 'subjects / questions unchanged', (select count(*) from public.user_subjects), (select count(*) from public.user_questions);
select 'legacy attempts (expect 16)', count(*) from public.attempts;
