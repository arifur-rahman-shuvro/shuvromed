import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { useAttempts } from '../practice/attempts'
import { useUserData } from '../userdata/store'
import { runSync, type SyncReport } from './engine'
import { pendingCount } from './pending'
import { supabaseRemote, type SyncRemote } from './remote'

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncApi {
  state: SyncState
  pending: number
  lastSyncedAt: string | null
  errors: string[]
  syncNow: () => void
}

/** Builds the server connection for a user. Replaced in tests; null means "no server configured". */
export type RemoteFactory = (userId: string) => SyncRemote | null
export const defaultRemoteFactory: RemoteFactory = (userId) => (supabase ? supabaseRemote(supabase, userId) : null)
export const RemoteFactoryContext = createContext<RemoteFactory>(defaultRemoteFactory)

const SyncContext = createContext<SyncApi>({ state: 'off', pending: 0, lastSyncedAt: null, errors: [], syncNow: () => {} })
export const useSync = () => useContext(SyncContext)

const QUIET_MS = 3000 // wait for the student to stop tapping before uploading
const RETRY_MS = 60_000 // after a failure, do not hammer the server

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const factory = useContext(RemoteFactoryContext)
  const userId = user?.id
  const attempts = useAttempts(userId)
  const data = useUserData(userId)
  const pending = pendingCount(attempts, data)

  const [state, setState] = useState<SyncState>('idle')
  const [report, setReport] = useState<SyncReport | null>(null)
  const running = useRef(false)
  const remote = useMemo(() => (userId ? factory(userId) : null), [factory, userId])

  const syncNow = useCallback(async () => {
    if (!userId || !remote || running.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline')
      return
    }
    running.current = true
    setState('syncing')
    try {
      const r = await runSync(userId, remote)
      setReport(r)
      setState(r.errors.length ? 'error' : 'idle')
    } catch (e) {
      setReport({ at: new Date().toISOString(), attemptsPushed: 0, attemptsPulled: 0, errors: [e instanceof Error ? e.message : 'Unexpected error'] })
      setState('error')
    } finally {
      running.current = false
    }
  }, [userId, remote])

  // Sign-in / page open, coming back online, and returning to the tab each trigger a sync.
  useEffect(() => {
    if (!remote) return
    void syncNow()
    const online = () => void syncNow()
    const visible = () => { if (document.visibilityState === 'visible') void syncNow() }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [remote, syncNow])

  // Anything new on this device is uploaded shortly after the student stops. Failures wait longer.
  useEffect(() => {
    if (!remote || pending === 0 || state === 'syncing') return
    const t = setTimeout(() => void syncNow(), state === 'error' || state === 'offline' ? RETRY_MS : QUIET_MS)
    return () => clearTimeout(t)
  }, [remote, pending, state, syncNow])

  const api: SyncApi = {
    state: remote ? state : 'off',
    pending,
    lastSyncedAt: report && report.errors.length === 0 ? report.at : null,
    errors: report?.errors ?? [],
    syncNow: () => void syncNow(),
  }
  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>
}
