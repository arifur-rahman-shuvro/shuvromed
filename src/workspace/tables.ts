import type { TableSpec } from './store/types'

/** Tables the on-device store keeps. Later phases add more (exams: Phase 8). */
export const WORKSPACE_TABLES: TableSpec[] = [
  { name: 'user_subjects', order: 1, mode: 'full', columns: ['name', 'description', 'sort_order', 'archived_at'] },
  { name: 'user_topics', order: 2, mode: 'full', parentKey: 'parent_id', columns: ['subject_id', 'parent_id', 'name', 'sort_order', 'archived_at'] },
  {
    name: 'user_questions', order: 3, mode: 'cursor',
    columns: ['subject_id', 'question_type', 'stem', 'difficulty', 'content', 'explanation', 'reference', 'archived_at', 'deleted_at'],
  },
  { name: 'user_question_topics', order: 4, mode: 'full', key: ['question_id', 'topic_id'], childOf: { table: 'user_questions', fk: 'question_id' }, columns: ['question_id', 'topic_id'] },
  { name: 'user_tags', order: 3, mode: 'full', columns: ['category', 'name', 'archived_at'] },
  { name: 'user_question_tag_links', order: 5, mode: 'full', key: ['question_id', 'tag_id'], childOf: { table: 'user_questions', fk: 'question_id' }, columns: ['question_id', 'tag_id'] },
  // Saved bank filters (migration M7). The server table may not exist yet; until it does, they stay on the device.
  { name: 'user_saved_filters', order: 3, mode: 'full', optionalRemote: true, columns: ['name', 'filter', 'sort'] },
  // Practice and exam sessions (migration M8). Until the server has the tables they stay on the device; attempts wait for sessions.
  { name: 'user_exams', order: 6, mode: 'full', optionalRemote: true, columns: ['name', 'config', 'archived_at'] },
  {
    name: 'user_sessions', order: 7, mode: 'cursor', optionalRemote: true,
    columns: ['kind', 'exam_id', 'title', 'config', 'question_ids', 'state', 'status', 'started_at', 'finished_at', 'time_limit_seconds', 'elapsed_ms', 'score', 'max_score', 'correct', 'incorrect', 'partial', 'unanswered', 'hidden_at'],
  },
  {
    name: 'user_question_attempts', order: 8, mode: 'cursor', cursorColumn: 'created_at', requires: 'user_sessions',
    columns: ['question_id', 'question_version', 'response', 'score', 'max_score', 'outcome', 'confidence', 'time_ms', 'mode', 'session_id', 'attempted_at'],
  },
]
