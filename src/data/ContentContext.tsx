import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import type { Question } from '../content/schema'
import { createContentClient, fetchFromSite, type Catalog, type ContentClient } from './loader'

/** The client the app uses. Tests provide another one that serves real built content from memory. */
// eslint-disable-next-line react-refresh/only-export-components
export const ContentClientContext = createContext<ContentClient>(createContentClient(fetchFromSite))

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: Catalog }
  | { status: 'error'; error: string }

const CatalogContext = createContext<{ state: CatalogState; retry: () => void } | null>(null)

function describe(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error'
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const client = useContext(ContentClientContext)
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    client.loadCatalog().then(
      (catalog) => !cancelled && setState({ status: 'ready', catalog }),
      (e) => !cancelled && setState({ status: 'error', error: describe(e) }),
    )
    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const value = useMemo(() => ({ state, retry }), [state, retry])
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

/** Layout route: loads the subject/topic catalogue once for everything under /app. */
export function ContentRoute() {
  return (
    <CatalogProvider>
      <Outlet />
    </CatalogProvider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used inside <CatalogProvider>')
  return { ...ctx.state, retry: ctx.retry }
}

export type QuestionsState =
  | { status: 'loading' }
  | { status: 'ready'; questions: Question[] }
  | { status: 'error'; error: string }

/** Loads the questions for the given subjects, or for every shipped subject when `subjectIds` is null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useQuestions(subjectIds: string[] | null): QuestionsState & { retry: () => void } {
  const client = useContext(ContentClientContext)
  const cat = useCatalog()
  const [state, setState] = useState<QuestionsState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const key = subjectIds ? subjectIds.join(',') : '*'
  const manifestIds = cat.status === 'ready' ? cat.catalog.manifest.subjects.map((s) => s.id) : null

  useEffect(() => {
    if (cat.status === 'error') {
      setState({ status: 'error', error: cat.error })
      return
    }
    if (!manifestIds) {
      setState({ status: 'loading' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const ids = key === '*' ? manifestIds : key.split(',').filter(Boolean)
    Promise.all(ids.map((id) => client.loadSubjectQuestions(id))).then(
      (lists) => !cancelled && setState({ status: 'ready', questions: lists.flat() }),
      (e) => !cancelled && setState({ status: 'error', error: describe(e) }),
    )
    return () => {
      cancelled = true
    }
    // manifestIds is derived from the catalogue status and key; depending on both is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, cat.status, attempt])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
