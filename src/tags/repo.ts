import { createContext, useContext } from 'react'
import { normName } from '../workspace/model'
import type { Result } from '../workspace/repo'
import type { Row, WorkspaceStore } from '../workspace/store/store'

const TAGS = 'user_tags'
const LINKS = 'user_question_tag_links'

export type TagCategory = 'exam' | 'general'
export const TAG_CATEGORIES: TagCategory[] = ['exam', 'general']
export const MAX_TAGS_PER_QUESTION = 60

export interface WTag {
  id: string
  category: TagCategory
  name: string
  archived: boolean
  /** How many questions carry this tag (hidden questions included, like the server). */
  uses: number
}

export interface TagRepo {
  list(): Promise<Result<WTag[]>>
  create(category: TagCategory, name: string): Promise<Result<WTag>>
  rename(id: string, name: string): Promise<Result<WTag>>
  setArchived(id: string, archived: boolean): Promise<Result<WTag>>
  /** Deletes the tag and its links. The questions stay; a question with no exam tag becomes Universal. */
  remove(id: string): Promise<Result<{ removedLinks: number }>>
}

/** A question is Universal when it carries no exam tag. General tags never change that. */
export function isUniversal(tagIds: string[], tags: Pick<WTag, 'id' | 'category'>[]): boolean {
  const exam = new Set(tags.filter((t) => t.category === 'exam').map((t) => t.id))
  return !tagIds.some((id) => exam.has(id))
}

const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const bad = <T,>(error: string): Result<T> => ({ data: null, error })
const DUP = 'That tag already exists in this group.'

const toTag = (r: Row, uses: number): WTag => ({ id: r.id, category: r.category as TagCategory, name: String(r.name), archived: r.archived_at != null, uses })

/** Tags on the device. Same rules as the database: a name is 1-80 characters and unique within its group. */
export function localTagRepo(store: WorkspaceStore): TagRepo {
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return bad(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const countUses = async (): Promise<Map<string, number>> => {
    const m = new Map<string, number>()
    for (const l of await store.list(LINKS)) m.set(String(l.tag_id), (m.get(String(l.tag_id)) ?? 0) + 1)
    return m
  }
  const load = async (id: string): Promise<WTag> => toTag((await store.get(TAGS, id)) as Row, (await countUses()).get(id) ?? 0)
  const checkName = (name: string): string | null => {
    const n = name.trim()
    if (!n) return 'Write a name for the tag.'
    if (n.length > 80) return 'Keep the tag name to 80 characters or fewer.'
    return null
  }
  return {
    list: () => guard(async () => {
      const uses = await countUses()
      const rows = await store.list(TAGS)
      return ok(rows.map((r) => toTag(r, uses.get(r.id) ?? 0)).sort((a, b) => a.name.localeCompare(b.name)))
    }),
    create: (category, name) => guard(async () => {
      const problem = checkName(name)
      if (problem) return bad(problem)
      if (!TAG_CATEGORIES.includes(category)) return bad('Choose exam or general.')
      const all = await store.list(TAGS)
      if (all.some((t) => t.category === category && normName(String(t.name)) === normName(name))) return bad(DUP)
      const row = await store.create(TAGS, { category, name: name.trim(), archived_at: null })
      return ok(toTag(row, 0))
    }),
    rename: (id, name) => guard(async () => {
      const cur = await store.get(TAGS, id)
      if (!cur) return bad('That tag no longer exists.')
      const problem = checkName(name)
      if (problem) return bad(problem)
      const all = await store.list(TAGS)
      if (all.some((t) => t.id !== id && t.category === cur.category && normName(String(t.name)) === normName(name))) return bad(DUP)
      await store.update(TAGS, id, { name: name.trim() })
      return ok(await load(id))
    }),
    setArchived: (id, archived) => guard(async () => {
      if (!(await store.get(TAGS, id))) return bad('That tag no longer exists.')
      await store.update(TAGS, id, { archived_at: archived ? store.now() : null })
      return ok(await load(id))
    }),
    remove: (id) => guard(async () => {
      if (!(await store.get(TAGS, id))) return bad('That tag no longer exists.')
      const links = (await store.list(LINKS)).filter((l) => l.tag_id === id)
      await store.apply([
        ...links.map((l) => ({ table: LINKS, id: `${l.question_id}:${id}`, remove: true as const })),
        { table: TAGS, id, remove: true as const },
      ])
      return ok({ removedLinks: links.length })
    }),
  }
}

export const TagRepoContext = createContext<TagRepo | null>(null)
const unavailable = <T,>(): Promise<Result<T>> => Promise.resolve(bad('Your workspace is not ready yet.'))
const notReady: TagRepo = { list: unavailable, create: unavailable, rename: unavailable, setArchived: unavailable, remove: unavailable }
export const useTagRepo = (): TagRepo => useContext(TagRepoContext) ?? notReady
