import { createContext, useContext } from 'react'
import { normName } from '../workspace/model'
import type { Result } from '../workspace/repo'
import type { Change, Row, WorkspaceStore } from '../workspace/store/store'
import { MAX_TAGS_PER_QUESTION } from '../tags/repo'
import { DIFFICULTIES, validateQuestion, type Difficulty, type QuestionContent, type QuestionType } from './schema'

const QUESTIONS = 'user_questions'
const LINKS = 'user_question_topics'
const SUBJECTS = 'user_subjects'
const TOPICS = 'user_topics'
const TAG_LINKS = 'user_question_tag_links'
const TAGS = 'user_tags'

export interface WQuestion {
  id: string
  subjectId: string
  type: QuestionType
  stem: string
  difficulty: Difficulty | null
  content: QuestionContent
  explanation: string | null
  reference: string | null
  topicIds: string[]
  tagIds: string[]
  /** The version the server last confirmed; null until the question has reached the server once. */
  version: number | null
  archived: boolean
  deleted: boolean
  updatedAt: string
}

/** What the editor saves. Everything about the answer lives in `content` (see schema.ts). */
export interface QuestionInput {
  subjectId: string
  type: QuestionType
  stem: string
  difficulty: Difficulty | null
  content: QuestionContent
  explanation: string | null
  reference: string | null
  topicIds: string[]
  /** Leave out to keep the question's tags as they are. */
  tagIds?: string[]
}

export interface BulkTagChange { add?: string[]; remove?: string[] }

export interface QuestionRepo {
  /** Questions that are not deleted (archived ones included, flagged). */
  list(): Promise<Result<WQuestion[]>>
  get(id: string): Promise<Result<WQuestion | null>>
  create(input: QuestionInput): Promise<Result<WQuestion>>
  update(id: string, input: QuestionInput): Promise<Result<WQuestion>>
  /** Adds and/or removes tags on many questions at once; all of it is saved together or not at all. */
  bulkTags(ids: string[], change: BulkTagChange): Promise<Result<{ changed: number }>>
  setArchived(id: string, archived: boolean): Promise<Result<WQuestion>>
  /** Delete hides the question everywhere. Its versions and answers are kept. */
  setDeleted(id: string, deleted: boolean): Promise<Result<WQuestion>>
  /** Other questions with the same wording (ignoring case, spacing and blank markers). */
  findDuplicates(stem: string, excludeId?: string): Promise<Result<WQuestion[]>>
  /** An unsaved editor draft kept on the device, so an interruption loses nothing. */
  saveDraft(key: string, draft: unknown): Promise<void>
  loadDraft<T>(key: string): Promise<T | null>
  clearDraft(key: string): Promise<void>
}

const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const bad = <T,>(error: string): Result<T> => ({ data: null, error })
const clean = (s: string | null): string | null => { const t = (s ?? '').trim(); return t ? t : null }
/** Wording key for duplicate detection: blank markers and case, spacing and accents-free comparison. */
export const stemKey = (stem: string): string => normName(stem.replace(/\{\{[^}]*\}\}/g, ' ___ '))

const toQuestion = (r: Row, topicIds: string[], tagIds: string[] = []): WQuestion => ({
  id: r.id,
  subjectId: String(r.subject_id),
  type: r.question_type as QuestionType,
  stem: String(r.stem),
  difficulty: (r.difficulty as Difficulty | null) ?? null,
  content: r.content as QuestionContent,
  explanation: (r.explanation as string | null) ?? null,
  reference: (r.reference as string | null) ?? null,
  topicIds,
  tagIds,
  version: typeof r.current_version === 'number' ? r.current_version : null,
  archived: r.archived_at != null,
  deleted: r.deleted_at != null,
  updatedAt: String(r.updated_at ?? ''),
})

/**
 * Questions on the device. It applies the same rules as the database (subject required, topics from that subject,
 * valid content for the type), so a question that is accepted here will not be refused when it is sent.
 */
export function localQuestionRepo(store: WorkspaceStore): QuestionRepo {
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return bad(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const group = async (table: string, col: string): Promise<Map<string, string[]>> => {
    const m = new Map<string, string[]>()
    for (const l of await store.list(table)) {
      const q = String(l.question_id)
      m.set(q, [...(m.get(q) ?? []), String(l[col])])
    }
    return m
  }
  const linksByQuestion = () => group(LINKS, 'topic_id')
  const tagsByQuestion = () => group(TAG_LINKS, 'tag_id')
  const load = async (id: string): Promise<WQuestion | null> => {
    const r = await store.get(QUESTIONS, id)
    if (!r) return null
    return toQuestion(r, (await linksByQuestion()).get(id) ?? [], (await tagsByQuestion()).get(id) ?? [])
  }
  /** Checks an input against the contract and the data on the device. Returns cleaned values. */
  const check = async (input: QuestionInput): Promise<Result<{ stem: string; content: QuestionContent; topicIds: string[]; tagIds: string[] | null }>> => {
    const v = validateQuestion(input.type, input.stem, input.content)
    if (!v.ok) return bad(v.problems[0].message)
    if (input.difficulty !== null && !DIFFICULTIES.includes(input.difficulty)) return bad('Choose easy, medium or hard, or leave difficulty empty.')
    if ((input.explanation ?? '').length > 20000) return bad('Keep the explanation to 20000 characters or fewer.')
    if ((input.reference ?? '').length > 2000) return bad('Keep the reference to 2000 characters or fewer.')
    if (!(await store.get(SUBJECTS, input.subjectId))) return bad('Choose a subject for this question.')
    const topicIds = [...new Set(input.topicIds)]
    if (topicIds.length > 30) return bad('A question can have at most 30 topics.')
    const topics = await store.list(TOPICS)
    for (const t of topicIds) {
      const row = topics.find((x) => x.id === t)
      if (!row) return bad('One of the topics no longer exists.')
      if (row.subject_id !== input.subjectId) return bad('A topic can only be added to a question in the same subject.')
    }
    let tagIds: string[] | null = null
    if (input.tagIds) {
      tagIds = [...new Set(input.tagIds)]
      if (tagIds.length > MAX_TAGS_PER_QUESTION) return bad(`A question can have at most ${MAX_TAGS_PER_QUESTION} tags.`)
      for (const t of tagIds) if (!(await store.get(TAGS, t))) return bad('One of the tags no longer exists.')
    }
    // A round trip through JSON drops keys whose value is undefined, so exactly what is saved is what the server receives.
    return ok({ stem: v.stem, content: JSON.parse(JSON.stringify(v.content)) as QuestionContent, topicIds, tagIds })
  }
  const columns = (input: QuestionInput, c: { stem: string; content: QuestionContent }) => ({
    subject_id: input.subjectId, question_type: input.type, stem: c.stem, difficulty: input.difficulty, content: c.content,
    explanation: clean(input.explanation), reference: clean(input.reference),
  })

  return {
    list: () => guard(async () => {
      const links = await linksByQuestion()
      const tagLinks = await tagsByQuestion()
      const rows = (await store.list(QUESTIONS)).filter((r) => r.deleted_at == null)
      return ok(rows.map((r) => toQuestion(r, links.get(r.id) ?? [], tagLinks.get(r.id) ?? [])))
    }),
    get: (id) => guard(async () => ok(await load(id))),

    create: (input) => guard(async () => {
      const c = await check(input)
      if (c.error || !c.data) return bad(c.error ?? 'Could not save.')
      const id = crypto.randomUUID()
      await store.apply([
        { table: QUESTIONS, id, create: { ...columns(input, c.data), archived_at: null, deleted_at: null } },
        ...c.data.topicIds.map((t) => ({ table: LINKS, id: `${id}:${t}`, create: { question_id: id, topic_id: t } })),
        ...(c.data.tagIds ?? []).map((t) => ({ table: TAG_LINKS, id: `${id}:${t}`, create: { question_id: id, tag_id: t } })),
      ])
      return ok((await load(id)) as WQuestion)
    }),

    update: (id, input) => guard(async () => {
      const cur = await store.get(QUESTIONS, id)
      if (!cur) return bad('That question no longer exists.')
      const c = await check(input)
      if (c.error || !c.data) return bad(c.error ?? 'Could not save.')
      const have = (await linksByQuestion()).get(id) ?? []
      const want = new Set(c.data.topicIds)
      const haveTags = (await tagsByQuestion()).get(id) ?? []
      const wantTags = new Set(c.data.tagIds ?? haveTags)
      await store.apply([
        ...haveTags.filter((t) => !wantTags.has(t)).map((t) => ({ table: TAG_LINKS, id: `${id}:${t}`, remove: true as const })),
        ...have.filter((t) => !want.has(t)).map((t) => ({ table: LINKS, id: `${id}:${t}`, remove: true as const })),
        { table: QUESTIONS, id, update: columns(input, c.data) },
        ...c.data.topicIds.filter((t) => !have.includes(t)).map((t) => ({ table: LINKS, id: `${id}:${t}`, create: { question_id: id, topic_id: t } })),
        ...[...wantTags].filter((t) => !haveTags.includes(t)).map((t) => ({ table: TAG_LINKS, id: `${id}:${t}`, create: { question_id: id, tag_id: t } })),
      ])
      return ok((await load(id)) as WQuestion)
    }),

    bulkTags: (ids, change) => guard(async () => {
      const add = [...new Set(change.add ?? [])]
      const remove = new Set(change.remove ?? [])
      if (add.some((t) => remove.has(t))) return bad('The same tag cannot be added and removed together.')
      for (const t of [...add, ...remove]) if (!(await store.get(TAGS, t))) return bad('One of the tags no longer exists.')
      const have = await tagsByQuestion()
      const changes: Change[] = []
      let changed = 0
      for (const id of new Set(ids)) {
        const q = await store.get(QUESTIONS, id)
        if (!q || q.deleted_at != null) continue
        const cur = have.get(id) ?? []
        const toAdd = add.filter((t) => !cur.includes(t))
        const toRemove = cur.filter((t) => remove.has(t))
        if (cur.length + toAdd.length - toRemove.length > MAX_TAGS_PER_QUESTION) return bad(`A question can have at most ${MAX_TAGS_PER_QUESTION} tags.`)
        if (!toAdd.length && !toRemove.length) continue
        changed++
        for (const t of toRemove) changes.push({ table: TAG_LINKS, id: `${id}:${t}`, remove: true })
        for (const t of toAdd) changes.push({ table: TAG_LINKS, id: `${id}:${t}`, create: { question_id: id, tag_id: t } })
      }
      if (changes.length) await store.apply(changes)
      return ok({ changed })
    }),
    setArchived: (id, archived) => guard(async () => {
      if (!(await store.get(QUESTIONS, id))) return bad('That question no longer exists.')
      await store.apply([{ table: QUESTIONS, id, update: { archived_at: archived ? store.now() : null } }])
      return ok((await load(id)) as WQuestion)
    }),
    setDeleted: (id, deleted) => guard(async () => {
      if (!(await store.get(QUESTIONS, id))) return bad('That question no longer exists.')
      await store.apply([{ table: QUESTIONS, id, update: { deleted_at: deleted ? store.now() : null } }])
      return ok((await load(id)) as WQuestion)
    }),

    findDuplicates: (stem, excludeId) => guard(async () => {
      const key = stemKey(stem)
      if (!key.replace(/[_\s]/g, '')) return ok([])
      const links = await linksByQuestion()
      const hits = (await store.list(QUESTIONS)).filter((r) => r.deleted_at == null && r.id !== excludeId && stemKey(String(r.stem)) === key)
      return ok(hits.map((r) => toQuestion(r, links.get(r.id) ?? [])))
    }),

    saveDraft: (key, draft) => store.backend.setMeta(`draft/${key}`, draft),
    loadDraft: async <T,>(key: string) => ((await store.backend.getMeta<T>(`draft/${key}`)) ?? null) as T | null,
    clearDraft: (key) => store.backend.setMeta(`draft/${key}`, null),
  }
}

export const QuestionRepoContext = createContext<QuestionRepo | null>(null)
const unavailable = <T,>(): Promise<Result<T>> => Promise.resolve(bad('Your workspace is not ready yet.'))
const notReady: QuestionRepo = {
  list: () => unavailable(), get: () => unavailable(), create: () => unavailable(), update: () => unavailable(), bulkTags: () => unavailable(), setArchived: () => unavailable(),
  setDeleted: () => unavailable(), findDuplicates: () => unavailable(), saveDraft: async () => undefined, loadDraft: async () => null, clearDraft: async () => undefined,
}
export const useQuestionRepo = (): QuestionRepo => useContext(QuestionRepoContext) ?? notReady
