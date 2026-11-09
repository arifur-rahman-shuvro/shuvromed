-- Rollback for M7. Removes ONLY the saved-filters table and its function. Nothing else is touched.
-- WARNING: deletes any saved filters. Questions, tags, subjects and topics are not affected.
begin;
drop table if exists public.user_saved_filters cascade;
drop function if exists public.user_saved_filters_cap();
commit;
