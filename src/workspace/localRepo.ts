import { descendantIds, normName, type WSubject, type WTopic } from './model'
import type { Row, WorkspaceStore } from './store/store'
import type { Result, WorkspaceRepo } from './repo'

const SUBJECTS = 'user_subjects'
const TOPICS = 'user_topics'

const toSubject = (r: Row): WSubject => ({ id: r.id, name: String(r.name), description: (r.description as string | null) ?? null, archived: r.archived_at != null, rowVersion: Number(r.row_version ?? 0) })
const toTopic = (r: Row): WTopic => ({ id: r.id, subjectId: String(r.subject_id), parentId: (r.parent_id as string | null) ?? null, name: String(r.name), archived: r.archived_at != null, rowVersion: Number(r.row_version ?? 0) })
const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const bad = <T,>(error: string): Result<T> => ({ data: null, error })
const DUP = 'That name is already used here.'

/**
 * The workspace repo backed by the on-device store. It enforces the same rules as the database (unique names,
 * parent in the same subject, no loops, nothing deleted while it still has content), so a change that is accepted
 * here will not be refused later when it is sent to the server.
 */
export function localWorkspaceRepo(store: WorkspaceStore): WorkspaceRepo {
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return bad(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const usedBy = async (table: string, where: (r: Row) => boolean): Promise<number> =>
    store.has(table) ? store.count(table, where) : 0
  // Hidden (deleted) questions still hold on to their subject and topics on the server, so they count here too.
  const questionsInSubject = (id: string) => usedBy('user_questions', (r) => r.subject_id === id)
  const questionsInTopic = (id: string) => usedBy('user_question_topics', (r) => r.topic_id === id)

  return {
    load: () => guard(async () => ok({ subjects: (await store.list(SUBJECTS)).map(toSubject), topics: (await store.list(TOPICS)).map(toTopic) })),
    subjectUse: (id) => guard(async () => ok({ topics: await store.count(TOPICS, (r) => r.subject_id === id), questions: await questionsInSubject(id) })),
    topicUse: (id) => guard(async () => ok({ topics: await store.count(TOPICS, (r) => r.parent_id === id), questions: await questionsInTopic(id) })),

    createSubject: (name, description) => guard(async () => {
      const all = await store.list(SUBJECTS)
      if (all.some((s) => normName(String(s.name)) === normName(name))) return bad(DUP)
      return ok(toSubject(await store.create(SUBJECTS, { name, description, sort_order: 0, archived_at: null })))
    }),
    updateSubject: (id, p) => guard(async () => {
      const patch: Record<string, unknown> = {}
      if (p.name !== undefined) {
        const all = await store.list(SUBJECTS)
        if (all.some((s) => s.id !== id && normName(String(s.name)) === normName(p.name as string))) return bad(DUP)
        patch.name = p.name
      }
      if (p.description !== undefined) patch.description = p.description
      if (p.archived !== undefined) patch.archived_at = p.archived ? store.now() : null
      return ok(toSubject(await store.update(SUBJECTS, id, patch)))
    }),
    deleteSubject: (id) => guard(async () => {
      if ((await store.count(TOPICS, (r) => r.subject_id === id)) > 0 || (await questionsInSubject(id)) > 0) return bad('This still has items inside it. Move or remove them first.')
      await store.remove(SUBJECTS, id)
      return ok(undefined as void)
    }),

    createTopic: (subjectId, parentId, name) => guard(async () => {
      const topics = await store.list(TOPICS)
      if (parentId) {
        const parent = topics.find((t) => t.id === parentId)
        if (!parent || parent.subject_id !== subjectId) return bad('A parent topic must belong to the same subject')
      }
      if (topics.some((t) => t.subject_id === subjectId && (t.parent_id ?? null) === parentId && normName(String(t.name)) === normName(name))) return bad(DUP)
      return ok(toTopic(await store.create(TOPICS, { subject_id: subjectId, parent_id: parentId, name, sort_order: 0, archived_at: null })))
    }),
    updateTopic: (id, p) => guard(async () => {
      const topics = await store.list(TOPICS)
      const cur = topics.find((t) => t.id === id)
      if (!cur) return bad('That item no longer exists.')
      const patch: Record<string, unknown> = {}
      const name = p.name ?? String(cur.name)
      const parentId = p.parentId !== undefined ? p.parentId : ((cur.parent_id as string | null) ?? null)
      if (p.parentId !== undefined && parentId) {
        const parent = topics.find((t) => t.id === parentId)
        if (!parent || parent.subject_id !== cur.subject_id) return bad('A parent topic must belong to the same subject')
        if (parentId === id || descendantIds(topics.map(toTopic), id).has(parentId)) return bad('That would make a topic its own ancestor')
      }
      if (p.name !== undefined || p.parentId !== undefined) {
        if (topics.some((t) => t.id !== id && t.subject_id === cur.subject_id && (t.parent_id ?? null) === parentId && normName(String(t.name)) === normName(name))) return bad(DUP)
      }
      if (p.name !== undefined) patch.name = p.name
      if (p.parentId !== undefined) patch.parent_id = p.parentId
      if (p.archived !== undefined) patch.archived_at = p.archived ? store.now() : null
      return ok(toTopic(await store.update(TOPICS, id, patch)))
    }),
    deleteTopic: (id) => guard(async () => {
      if ((await store.count(TOPICS, (r) => r.parent_id === id)) > 0 || (await questionsInTopic(id)) > 0) return bad('This still has items inside it. Move or remove them first.')
      await store.remove(TOPICS, id)
      return ok(undefined as void)
    }),
  }
}
