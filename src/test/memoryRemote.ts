import type { Attempt } from '../practice/attempts'
import { flagKey, type FlagReason, type OutboxItem } from '../userdata/model'
import type { ServerSnapshot } from '../sync/merge'
import type { Fetched, RemoteAttempt, Result, SyncRemote } from '../sync/remote'

/** An in-memory stand-in for the server that enforces the same keys and uniqueness the database does. */
export class MemoryServer {
  tick = 0
  collections = new Map<string, { id: string; name: string; createdAt: string }>()
  bookmarks = new Map<string, { questionId: string; collectionId: string | null; createdAt: string }>()
  notes = new Map<string, { questionId: string; body: string; updatedAt: string }>()
  flags = new Map<string, { questionId: string; reason: FlagReason; comment: string | null; createdAt: string }>()
  attempts = new Map<string, RemoteAttempt>()
  /** Set to make every call fail like a dead connection. */
  offline = false
  calls: string[] = []
  /** Runs once, in the middle of the next note upload (to simulate an edit during a sync). */
  duringNotePush: (() => void) | null = null

  /** Server clock: every call to this returns a later time. */
  now(): string {
    this.tick += 1
    return new Date(Date.UTC(2026, 10, 7, 0, 0, this.tick)).toISOString()
  }
}

export function memoryRemote(s: MemoryServer): SyncRemote {
  const down = (): Result | null => (s.offline ? { ok: false, error: 'Failed to fetch' } : null)
  const ok = (): Result => ({ ok: true })
  return {
    async fetchSnapshot(): Promise<Fetched<ServerSnapshot>> {
      s.calls.push('fetchSnapshot')
      if (s.offline) return { ok: false, error: 'Failed to fetch' }
      return { ok: true, value: { collections: [...s.collections.values()], bookmarks: [...s.bookmarks.values()], notes: [...s.notes.values()], flags: [...s.flags.values()] } }
    },
    async fetchAttempts(since): Promise<Fetched<RemoteAttempt[]>> {
      s.calls.push('fetchAttempts')
      if (s.offline) return { ok: false, error: 'Failed to fetch' }
      return { ok: true, value: [...s.attempts.values()].filter((a) => !since || a.createdAt >= since).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((a) => ({ ...a, contentVersion: 'synced' })) } // the server does not store the content version
    },
    async pushCollections(rows) {
      s.calls.push('pushCollections')
      const d = down(); if (d) return d
      for (const r of rows) {
        const clash = [...s.collections.values()].find((c) => c.id !== r.id && c.name.toLowerCase() === r.name.toLowerCase())
        if (clash) return { ok: false, error: 'duplicate key value violates unique constraint (user_id, name)' }
      }
      for (const r of rows) s.collections.set(r.id, { ...r })
      return ok()
    },
    async pushBookmarks(rows) {
      s.calls.push('pushBookmarks')
      const d = down(); if (d) return d
      for (const r of rows) if (r.collectionId && !s.collections.has(r.collectionId)) return { ok: false, error: 'violates foreign key constraint' }
      for (const r of rows) s.bookmarks.set(r.questionId, { ...r })
      return ok()
    },
    async pushNotes(rows) {
      s.calls.push('pushNotes')
      const d = down(); if (d) return d
      if (s.duringNotePush) { const f = s.duringNotePush; s.duringNotePush = null; f() }
      for (const r of rows) s.notes.set(r.questionId, { questionId: r.questionId, body: r.body, updatedAt: s.now() })
      return ok()
    },
    async pushFlags(rows) {
      s.calls.push('pushFlags')
      const d = down(); if (d) return d
      for (const r of rows) if (!s.flags.has(flagKey(r.questionId, r.reason))) s.flags.set(flagKey(r.questionId, r.reason), { ...r })
      return ok()
    },
    async pushAttempts(rows: Attempt[]) {
      s.calls.push('pushAttempts')
      const d = down(); if (d) return d
      for (const a of rows) if (!s.attempts.has(a.id)) s.attempts.set(a.id, { ...a, createdAt: s.now() }) // a repeat of the same id is ignored
      return ok()
    },
    async deleteRows(items: OutboxItem[]) {
      s.calls.push('deleteRows')
      const d = down(); if (d) return d
      for (const i of items) {
        if (i.table === 'bookmarks') s.bookmarks.delete(i.key)
        if (i.table === 'question_notes') s.notes.delete(i.key)
        if (i.table === 'flags') s.flags.delete(i.key)
        if (i.table === 'bookmark_collections') {
          s.collections.delete(i.key)
          for (const [k, b] of s.bookmarks) if (b.collectionId === i.key) s.bookmarks.set(k, { ...b, collectionId: null }) // the database un-files them
        }
      }
      return ok()
    },
  }
}

// ---- two "devices" sharing one account -------------------------------------------------------------
import { resetAttemptCache } from '../practice/attempts'
import { resetUserDataCache } from '../userdata/store'

const saved = new Map<string, Record<string, string>>()

/** Switches this process to behave as the named device: its own localStorage, like a separate phone. */
export function asDevice(name: string): void {
  const leaving = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) as string]))
  if (current) saved.set(current, leaving)
  localStorage.clear()
  for (const [k, v] of Object.entries(saved.get(name) ?? {})) localStorage.setItem(k, v)
  current = name
  resetAttemptCache()
  resetUserDataCache()
}
let current: string | null = null
export function resetDevices(): void {
  saved.clear()
  current = null
  localStorage.clear()
  resetAttemptCache()
  resetUserDataCache()
}
