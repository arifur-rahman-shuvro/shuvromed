import { createContext, useContext } from 'react'
import type { QuestionInput, WQuestion } from '../questions/repo'
import type { QuestionContent, QuestionType } from '../questions/schema'
import type { Result } from '../workspace/repo'
import type { VersionRow, WorkspaceRemote } from '../workspace/sync/remote'

export interface HistoryRepo {
  /** Every saved version of a question, newest first. Versions are kept by the server, so this needs a connection. */
  versions(questionId: string): Promise<Result<VersionRow[]>>
}

export function remoteHistoryRepo(remote: WorkspaceRemote | null): HistoryRepo {
  return {
    async versions(questionId) {
      if (!remote) return { data: null, error: 'History is kept on the server and needs a connection.' }
      const r = await remote.fetchVersions(questionId)
      if (!r.ok) return { data: null, error: r.transient ? 'You are offline. History is kept on the server, so connect and try again.' : r.message }
      return { data: r.rows, error: null }
    },
  }
}
export const HistoryRepoContext = createContext<HistoryRepo | null>(null)
export const useHistoryRepo = (): HistoryRepo => useContext(HistoryRepoContext) ?? { versions: async () => ({ data: null, error: 'Your workspace is not ready yet.' }) }

export type ChangedPart = 'wording' | 'answers' | 'explanation' | 'reference' | 'difficulty'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What changed from `prev` to `cur`, in plain words, for the history list. The first version has no `prev`. */
export function changedParts(prev: VersionRow | undefined, cur: VersionRow): ChangedPart[] {
  if (!prev) return []
  const out: ChangedPart[] = []
  if (prev.stem !== cur.stem) out.push('wording')
  if (!same(prev.content, cur.content)) out.push('answers')
  if ((prev.explanation ?? '') !== (cur.explanation ?? '')) out.push('explanation')
  if ((prev.reference ?? '') !== (cur.reference ?? '')) out.push('reference')
  if ((prev.difficulty ?? null) !== (cur.difficulty ?? null)) out.push('difficulty')
  return out
}

/**
 * Putting an old version back means saving its wording and answers as the question's NEXT version: history is never rewritten.
 * The question stays in its current subject, topics and tags. The type cannot change.
 */
export function restoreInput(current: WQuestion, v: VersionRow): { ok: true; input: QuestionInput } | { ok: false; error: string } {
  if (v.question_type !== current.type) return { ok: false, error: 'That version is a different question type, so it cannot be put back.' }
  return {
    ok: true,
    input: {
      subjectId: current.subjectId, type: v.question_type as QuestionType, stem: v.stem, difficulty: (v.difficulty as WQuestion['difficulty']) ?? null,
      content: v.content as QuestionContent, explanation: v.explanation, reference: v.reference, topicIds: current.topicIds,
    },
  }
}
