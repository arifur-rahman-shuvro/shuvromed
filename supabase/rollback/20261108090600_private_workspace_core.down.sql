-- Rollback for M6 (private workspace core). Removes ONLY objects created by M6. Legacy tables are untouched.
-- WARNING: drops the new private-workspace tables and any data in them. Take a backup first.
begin;
drop table if exists public.user_question_review_log, public.user_question_reports, public.user_question_reviews,
  public.user_question_notes, public.user_question_bookmarks, public.user_bookmark_collections,
  public.user_question_attempts, public.user_question_tag_links, public.user_question_topics,
  public.user_question_versions, public.user_questions, public.user_tags, public.user_topics, public.user_subjects cascade;
drop function if exists public.user_question_links_touch(), public.user_question_tag_links_check(),
  public.user_question_topics_check(), public.user_questions_after_write(), public.user_questions_before_write(),
  public.user_topics_check_tree(), public.question_content_hash(text, text, jsonb, text, text, text),
  public.valid_question_payload(text, text, jsonb), public.valid_scoring(text, jsonb),
  public.touch_row(), public.norm_name(text);
commit;
