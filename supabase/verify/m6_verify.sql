-- Run AFTER applying M6. Read-only. Expected results are in the comments.
select 'legacy attempts (expect 16)' as check, count(*) from public.attempts;
select 'legacy question_notes (expect 1)', count(*) from public.question_notes;
select 'users (expect 1)', count(*) from auth.users;
select 'new tables exist (expect 14)', count(*) from pg_tables where schemaname='public' and tablename like 'user\_%' escape '\' and tablename in ('user_subjects','user_topics','user_tags','user_questions','user_question_versions','user_question_topics','user_question_tag_links','user_question_attempts','user_bookmark_collections','user_question_bookmarks','user_question_notes','user_question_reviews','user_question_review_log','user_question_reports');
select 'new tables with RLS on (expect 14)', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relname in ('user_subjects','user_topics','user_tags','user_questions','user_question_versions','user_question_topics','user_question_tag_links','user_question_attempts','user_bookmark_collections','user_question_bookmarks','user_question_notes','user_question_reviews','user_question_review_log','user_question_reports');
select 'anon grants on new tables (expect 0)', count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name like 'user\_question%' escape '\';
select 'rows in new tables (expect 0)', (select count(*) from public.user_subjects)+(select count(*) from public.user_questions);
