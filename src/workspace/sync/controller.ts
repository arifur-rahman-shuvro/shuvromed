import type { WorkspaceStore } from '../store/store'
import { runWorkspaceSync, type WorkspaceSyncReport } from './engine'
import type { WorkspaceRemote } from './remote'

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncSnapshot {
  state: SyncState
  pending: number
  rejected: { table: string; id: string; message: string; label: string }[]
  lastSyncAt: string | null
  errors: string[]
  /** Counts up whenever a sync changed local data, so screens know to reload. */
  dataVersion: number
}

export interface ControllerOptions {
  online?: () => boolean
  debounceMs?: number
  now?: () => Date
}

/** Decides when to sync (after changes, on reconnect, on demand) and keeps one sync running at a time. */
export class SyncController {
  private snap: SyncSnapshot = { state: 'idle', pending: 0, rejected: [], lastSyncAt: null, errors: [], dataVersion: 0 }
  private listeners = new Set<() => void>()
  private running: Promise<WorkspaceSyncReport | null> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: () => void
  private closed = false

  private store: WorkspaceStore
  private remote: WorkspaceRemote | null
  private opts: ControllerOptions

  constructor(store: WorkspaceStore, remote: WorkspaceRemote | null, opts: ControllerOptions = {}) {
    this.store = store
    this.remote = remote
    this.opts = opts
    if (!remote) this.snap = { ...this.snap, state: 'off' }
    this.unsubscribe = store.subscribe(() => { void this.refreshPending(); this.schedule() })
    void this.refreshPending()
    void store.backend.getMeta<string>('lastSyncAt').then((t) => { if (t) this.set({ lastSyncAt: t }) })
  }

  getSnapshot = (): SyncSnapshot => this.snap
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private set(p: Partial<SyncSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()) }

  private async refreshPending() {
    const p = await this.store.pending()
    if (!this.closed) this.set({ pending: p.count, rejected: p.rejected })
  }

  /** Called after a local change: waits a moment so a burst of edits goes out as one sync. */
  schedule(): void {
    if (!this.remote || this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.syncNow() }, this.opts.debounceMs ?? 1500)
  }

  async syncNow(): Promise<WorkspaceSyncReport | null> {
    if (!this.remote || this.closed) return null
    if (this.running) { this.again = true; return this.running }
    if (this.opts.online && !this.opts.online()) { this.set({ state: 'offline' }); return null }
    this.set({ state: 'syncing' })
    this.running = (async () => {
      let report: WorkspaceSyncReport | null = null
      try {
        report = await runWorkspaceSync(this.store, this.remote as WorkspaceRemote, this.opts.now)
        const p = await this.store.pending()
        const hadChanges = report.pulled + report.removed > 0
        this.set({
          state: report.offline ? 'offline' : report.errors.length ? 'error' : 'idle',
          pending: p.count, rejected: p.rejected, errors: report.errors, lastSyncAt: report.offline ? this.snap.lastSyncAt : report.at,
          dataVersion: hadChanges ? this.snap.dataVersion + 1 : this.snap.dataVersion,
        })
      } catch (e) {
        this.set({ state: 'error', errors: [e instanceof Error ? e.message : 'Sync failed'] })
      } finally {
        this.running = null
      }
      if (this.again && !this.closed) { this.again = false; void this.syncNow() }
      return report
    })()
    return this.running
  }

  async discardRejected(): Promise<void> {
    await this.store.discardRejected()
    await this.refreshPending()
    this.set({ dataVersion: this.snap.dataVersion + 1 }) // local data changed: screens must reload
    await this.syncNow()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.unsubscribe()
  }
}
