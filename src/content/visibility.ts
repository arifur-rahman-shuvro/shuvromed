import type { Question } from './schema'

/**
 * The one rule deciding whether a student may see a question.
 *  - Normal content: status must be Published AND the owner must have reviewed it.
 *  - Demo content: shown only when demo is allowed, always labelled DEMO, never when archived.
 * Unreviewed, non-demo questions are never visible, whatever their status says.
 */
export function isStudentVisible(q: Question, opts: { allowDemo: boolean }): boolean {
  if (q.isDemo) return opts.allowDemo && q.status !== 'archived'
  return q.status === 'published' && !q.unreviewed
}
