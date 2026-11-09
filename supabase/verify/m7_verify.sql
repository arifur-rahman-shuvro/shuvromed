-- Run AFTER applying M7. Read-only. Expected results are in the comments.
select 'table exists (expect 1)' as check, count(*) from pg_tables where schemaname='public' and tablename='user_saved_filters';
select 'RLS on (expect 1)', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='user_saved_filters' and c.relrowsecurity;
select 'policies (expect 4)', count(*) from pg_policies where schemaname='public' and tablename='user_saved_filters';
select 'anon grants (expect 0)', count(*) from information_schema.role_table_grants where table_schema='public' and table_name='user_saved_filters' and grantee='anon';
select 'rows (expect 0)', count(*) from public.user_saved_filters;
select 'other private data unchanged: subjects / questions', (select count(*) from public.user_subjects), (select count(*) from public.user_questions);
select 'legacy attempts (expect 16)', count(*) from public.attempts;
