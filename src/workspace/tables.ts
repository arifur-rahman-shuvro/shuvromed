import type { TableSpec } from './store/types'

/** Tables the on-device store keeps. Later phases add more (tags: Phase 5; exams: Phase 8). */
export const WORKSPACE_TABLES: TableSpec[] = [
  { name: 'user_subjects', order: 1, mode: 'full', columns: ['name', 'description', 'sort_order', 'archived_at'] },
  { name: 'user_topics', order: 2, mode: 'full', parentKey: 'parent_id', columns: ['subject_id', 'parent_id', 'name', 'sort_order', 'archived_at'] },
  {
    name: 'user_questions', order: 3, mode: 'cursor',
    columns: ['subject_id', 'question_type', 'stem', 'difficulty', 'content', 'explanation', 'reference', 'archived_at', 'deleted_at'],
  },
  { name: 'user_question_topics', order: 4, mode: 'full', key: ['question_id', 'topic_id'], childOf: { table: 'user_questions', fk: 'question_id' }, columns: ['question_id', 'topic_id'] },
]
