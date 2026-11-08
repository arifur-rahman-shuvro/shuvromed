import type { TableSpec } from './store/types'

/** Tables the on-device store keeps. Later phases add the question tables here (Phase 4). */
export const WORKSPACE_TABLES: TableSpec[] = [
  { name: 'user_subjects', order: 1, mode: 'full', columns: ['name', 'description', 'sort_order', 'archived_at'] },
  { name: 'user_topics', order: 2, mode: 'full', parentKey: 'parent_id', columns: ['subject_id', 'parent_id', 'name', 'sort_order', 'archived_at'] },
]
