import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Skeleton } from '../components/ui'
import { supabase } from '../lib/supabase'
import { localQuestionRepo, QuestionRepoContext, type QuestionRepo } from '../questions/repo'
import { localWorkspaceRepo } from './localRepo'
import { WorkspaceRepoContext, type WorkspaceRepo } from './repo'
import { openIdbBackend } from './store/idb'
import { memoryBackend } from './store/memory'
import { WorkspaceStore } from './store/store'
import type { Backend } from './store/types'
import { WORKSPACE_TABLES } from './tables'
import { SyncController, type SyncSnapshot } from './sync/controller'
import { supabaseWorkspaceRemote, type WorkspaceRemote } from './sync/remote'

/** Test hooks: swap the on-device database or the server. In the real app everything here is left unset. */
export interface WorkspaceEnv {
  openBackend?: (userId: string) => Promise<Backend>
  remote?: WorkspaceRemote | null
  debounceMs?: number
}
export const WorkspaceEnvContext = createContext<WorkspaceEnv>({})

export interface WorkspaceSync {
  snapshot: SyncSnapshot
  /** False when this device could not open its on-device database, so changes live only until the app closes. */
  persistent: boolean
  syncNow(): void
  discardRejected(): void
}
const SyncContext = createContext<WorkspaceSync | null>(null)
/** Null when no real provider is above (for example in tests that supply a fake repo). */
export const useWorkspaceSync = (): WorkspaceSync | null => useContext(SyncContext)

interface Ready { repo: WorkspaceRepo; questions: QuestionRepo; controller: SyncController; persistent: boolean }

function Inner({ userId, children }: { userId: string; children: ReactNode }) {
  const env = useContext(WorkspaceEnvContext)
  const [ready, setReady] = useState<Ready | null>(null)

  useEffect(() => {
    let cancelled = false
    let controller: SyncController | null = null
    const cleanups: (() => void)[] = []
    void (async () => {
      let backend: Backend
      let persistent = true
      try {
        backend = await (env.openBackend ?? openIdbBackend)(userId)
      } catch {
        backend = memoryBackend()
        persistent = false
      }
      if (cancelled) return
      const store = new WorkspaceStore(backend, WORKSPACE_TABLES)
      const remote = env.remote !== undefined ? env.remote : supabase ? supabaseWorkspaceRemote(supabase) : null
      controller = new SyncController(store, remote, { online: () => navigator.onLine !== false, debounceMs: env.debounceMs })
      const go = () => { void controller?.syncNow() }
      const onVisible = () => { if (document.visibilityState === 'visible') go() }
      window.addEventListener('online', go)
      document.addEventListener('visibilitychange', onVisible)
      cleanups.push(() => { window.removeEventListener('online', go); document.removeEventListener('visibilitychange', onVisible) })
      go()
      setReady({ repo: localWorkspaceRepo(store), questions: localQuestionRepo(store), controller, persistent })
    })()
    return () => {
      cancelled = true
      cleanups.forEach((c) => c())
      controller?.close()
      setReady(null)
    }
  }, [userId, env])

  const snapshot = useSyncExternalStore(
    (cb) => (ready ? ready.controller.subscribe(cb) : () => {}),
    () => (ready ? ready.controller.getSnapshot() : null),
  )
  const value = useMemo<WorkspaceSync | null>(
    () => (ready && snapshot ? { snapshot, persistent: ready.persistent, syncNow: () => void ready.controller.syncNow(), discardRejected: () => void ready.controller.discardRejected() } : null),
    [ready, snapshot],
  )

  if (!ready || !value) {
    return <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-24 w-full" /></div>
  }
  return (
    <WorkspaceRepoContext.Provider value={ready.repo}>
      <QuestionRepoContext.Provider value={ready.questions}>
        <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
      </QuestionRepoContext.Provider>
    </WorkspaceRepoContext.Provider>
  )
}

/**
 * Gives the screens inside it the on-device workspace and keeps it in sync with the server in the background.
 * A repo supplied from outside (tests) is left alone.
 */
export default function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const outer = useContext(WorkspaceRepoContext)
  if (outer || !user) return <>{children}</>
  return <Inner userId={user.id}>{children}</Inner>
}
