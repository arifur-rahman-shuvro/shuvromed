import { createContext, useContext } from 'react'
import { normName } from '../workspace/model'
import type { Result } from '../workspace/repo'
import type { Row, WorkspaceStore } from '../workspace/store/store'
import { parseFilter, type BankFilter, type SortChoice } from './filter'

const TABLE = 'user_saved_filters'
export const MAX_SAVED_FILTERS = 100
const SORTS: SortChoice[] = ['edited-new', 'edited-old', 'wording']

export interface SavedFilter { id: string; name: string; filter: BankFilter; sort: SortChoice }

export interface SavedFilterRepo {
  list(): Promise<Result<SavedFilter[]>>
  create(name: string, filter: BankFilter, sort: SortChoice): Promise<Result<SavedFilter>>
  /** Replaces what a saved filter selects (used by "Update with the current filter"). */
  update(id: string, filter: BankFilter, sort: SortChoice): Promise<Result<SavedFilter>>
  rename(id: string, name: string): Promise<Result<SavedFilter>>
  remove(id: string): Promise<Result>
}

const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const bad = <T,>(error: string): Result<T> => ({ data: null, error })
const toSaved = (r: Row): SavedFilter => ({ id: r.id, name: String(r.name), filter: parseFilter(r.filter), sort: SORTS.includes(r.sort as SortChoice) ? (r.sort as SortChoice) : 'edited-new' })

/** Saved filters live on the device and sync like everything else. Until the server table exists (migration M7) they simply wait on the device. */
export function localSavedFilterRepo(store: WorkspaceStore): SavedFilterRepo {
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return bad(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const checkName = async (name: string, selfId?: string): Promise<string | null> => {
    const n = name.trim()
    if (!n) return 'Write a name for the filter.'
    if (n.length > 80) return 'Keep the name to 80 characters or fewer.'
    if ((await store.list(TABLE)).some((r) => r.id !== selfId && normName(String(r.name)) === normName(n))) return 'You already have a saved filter with that name.'
    return null
  }
  return {
    list: () => guard(async () => ok((await store.list(TABLE)).map(toSaved).sort((a, b) => a.name.localeCompare(b.name)))),
    create: (name, filter, sort) => guard(async () => {
      const problem = await checkName(name)
      if (problem) return bad(problem)
      if ((await store.list(TABLE)).length >= MAX_SAVED_FILTERS) return bad(`You can keep at most ${MAX_SAVED_FILTERS} saved filters.`)
      return ok(toSaved(await store.create(TABLE, { name: name.trim(), filter: JSON.parse(JSON.stringify(filter)), sort })))
    }),
    update: (id, filter, sort) => guard(async () => {
      if (!(await store.get(TABLE, id))) return bad('That saved filter no longer exists.')
      return ok(toSaved(await store.update(TABLE, id, { filter: JSON.parse(JSON.stringify(filter)), sort })))
    }),
    rename: (id, name) => guard(async () => {
      if (!(await store.get(TABLE, id))) return bad('That saved filter no longer exists.')
      const problem = await checkName(name, id)
      if (problem) return bad(problem)
      return ok(toSaved(await store.update(TABLE, id, { name: name.trim() })))
    }),
    remove: (id) => guard(async () => {
      if (await store.get(TABLE, id)) await store.remove(TABLE, id) // already gone is fine
      return { data: null, error: null }
    }),
  }
}

export const SavedFilterRepoContext = createContext<SavedFilterRepo | null>(null)
const unavailable = <T,>(): Promise<Result<T>> => Promise.resolve(bad('Your workspace is not ready yet.'))
const notReady: SavedFilterRepo = { list: unavailable, create: unavailable, update: unavailable, rename: unavailable, remove: unavailable }
export const useSavedFilterRepo = (): SavedFilterRepo => useContext(SavedFilterRepoContext) ?? notReady
