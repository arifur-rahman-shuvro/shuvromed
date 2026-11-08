import type { WSubject, WTopic } from '../workspace/model'
import type { Result, WorkspaceRepo } from '../workspace/repo'
import { normName } from '../workspace/model'

/** In-memory stand-in for the server rules (the real rules are tested against Postgres in supabase/tests). */
export function memoryWorkspace(seed?: { subjects?: WSubject[]; topics?: WTopic[]; questionsBySubject?: Record<string, number> }): WorkspaceRepo & { subjects: WSubject[]; topics: WTopic[] } {
  let n = 0
  const subjects = [...(seed?.subjects ?? [])]
  const topics = [...(seed?.topics ?? [])]
  const q = seed?.questionsBySubject ?? {}
  const ok = <T,>(data: T): Result<T> => ({ data, error: null })
  const bad = <T,>(error: string): Result<T> => ({ data: null, error })
  const repo = {
    subjects, topics,
    async load() { return ok({ subjects: [...subjects], topics: [...topics] }) },
    async subjectUse(id: string) { return ok({ topics: topics.filter((t) => t.subjectId === id).length, questions: q[id] ?? 0 }) },
    async topicUse(id: string) { return ok({ topics: topics.filter((t) => t.parentId === id).length, questions: 0 }) },
    async createSubject(name: string, description: string | null) {
      if (subjects.some((s) => normName(s.name) === normName(name))) return bad<WSubject>('That name is already used here.')
      const s: WSubject = { id: `s${++n}`, name, description, archived: false, rowVersion: 1 }
      subjects.push(s); return ok(s)
    },
    async updateSubject(id: string, p: { name?: string; description?: string | null; archived?: boolean }) {
      const i = subjects.findIndex((s) => s.id === id)
      subjects[i] = { ...subjects[i], ...(p.name !== undefined ? { name: p.name } : {}), ...(p.archived !== undefined ? { archived: p.archived } : {}), rowVersion: subjects[i].rowVersion + 1 }
      return ok(subjects[i])
    },
    async deleteSubject(id: string) { subjects.splice(subjects.findIndex((s) => s.id === id), 1); return ok(undefined as void) },
    async createTopic(subjectId: string, parentId: string | null, name: string) {
      const t: WTopic = { id: `t${++n}`, subjectId, parentId, name, archived: false, rowVersion: 1 }
      topics.push(t); return ok(t)
    },
    async updateTopic(id: string, p: { name?: string; parentId?: string | null; archived?: boolean }) {
      const i = topics.findIndex((t) => t.id === id)
      topics[i] = { ...topics[i], ...(p.name !== undefined ? { name: p.name } : {}), ...(p.parentId !== undefined ? { parentId: p.parentId } : {}), ...(p.archived !== undefined ? { archived: p.archived } : {}), rowVersion: topics[i].rowVersion + 1 }
      return ok(topics[i])
    },
    async deleteTopic(id: string) { topics.splice(topics.findIndex((t) => t.id === id), 1); return ok(undefined as void) },
  }
  return repo
}
