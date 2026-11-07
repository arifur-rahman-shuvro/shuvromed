import { flagKey, type Bookmark, type Collection, type Flag, type FlagReason, type Note, type OutboxItem, type UserData } from '../userdata/model'

/**
 * Pure rules for combining this device's bookmarks/notes/flags with what the server holds.
 * No network and no storage here, so every rule can be tested directly.
 *
 * Principles:
 *  - Nothing the student did on this device is thrown away: unsent rows are kept and queued for upload.
 *  - A row already known to the server (`synced`) that is no longer there was deleted on another device.
 *  - Deletions made here are queued in the outbox and are never undone by what the server still holds.
 */
export interface ServerSnapshot {
  collections: { id: string; name: string; createdAt: string }[]
  bookmarks: { questionId: string; collectionId: string | null; createdAt: string }[]
  notes: { questionId: string; body: string; updatedAt: string }[]
  flags: { questionId: string; reason: FlagReason; comment: string | null; createdAt: string }[]
}

export interface PushPlan {
  collections: Collection[]
  bookmarks: Bookmark[]
  notes: Note[]
  flags: Flag[]
  deletes: OutboxItem[]
}

export const emptyPlan = (): PushPlan => ({ collections: [], bookmarks: [], notes: [], flags: [], deletes: [] })

const pending = (d: UserData, table: OutboxItem['table'], key: string) => d.outbox.some((o) => o.table === table && o.key === key)
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function reconcile(local: UserData, server: ServerSnapshot): { data: UserData; plan: PushPlan } {
  const plan = emptyPlan()
  plan.deletes = [...local.outbox]

  // ---- collections -------------------------------------------------------------------------------
  const idRemap = new Map<string, string>() // local id -> server id, when the same name exists on both
  const collections: Collection[] = []
  const consumedLocal = new Set<string>()

  for (const s of server.collections) {
    if (pending(local, 'bookmark_collections', s.id)) continue // we are deleting it
    const mine = local.collections.find((c) => c.id === s.id)
    if (mine) {
      consumedLocal.add(mine.id)
      collections.push({ id: s.id, name: s.name, createdAt: s.createdAt, synced: true })
      continue
    }
    const sameNamed = local.collections.find((c) => !c.synced && !consumedLocal.has(c.id) && sameName(c.name, s.name))
    if (sameNamed) {
      consumedLocal.add(sameNamed.id)
      idRemap.set(sameNamed.id, s.id)
    }
    collections.push({ id: s.id, name: s.name, createdAt: s.createdAt, synced: true })
  }
  for (const c of local.collections) {
    if (consumedLocal.has(c.id)) continue
    if (!c.synced) {
      collections.push(c)
      plan.collections.push(c)
    }
    // synced here but gone from the server: deleted on another device, so it is dropped.
  }
  const knownCollection = new Set(collections.map((c) => c.id))
  const mapCollection = (id: string | null): string | null => {
    if (id === null) return null
    const mapped = idRemap.get(id) ?? id
    return knownCollection.has(mapped) ? mapped : null
  }

  // ---- bookmarks ---------------------------------------------------------------------------------
  const bookmarks: Bookmark[] = []
  const handled = new Set<string>()
  for (const s of server.bookmarks) {
    if (pending(local, 'bookmarks', s.questionId)) continue
    handled.add(s.questionId)
    const mine = local.bookmarks.find((b) => b.questionId === s.questionId)
    if (mine && !mine.synced) {
      const b = { ...mine, collectionId: mapCollection(mine.collectionId) }
      bookmarks.push(b)
      plan.bookmarks.push(b)
    } else {
      bookmarks.push({ questionId: s.questionId, collectionId: mapCollection(s.collectionId), createdAt: s.createdAt, synced: true })
    }
  }
  for (const b of local.bookmarks) {
    if (handled.has(b.questionId)) continue
    if (!b.synced) {
      const fixed = { ...b, collectionId: mapCollection(b.collectionId) }
      bookmarks.push(fixed)
      plan.bookmarks.push(fixed)
    }
    // synced but absent on the server: removed on another device.
  }
  // A synced bookmark whose collection was deleted elsewhere is now simply unfiled (the server did the same).
  for (let i = 0; i < bookmarks.length; i++) {
    const b = bookmarks[i]
    if (b.collectionId !== null && !knownCollection.has(b.collectionId)) bookmarks[i] = { ...b, collectionId: null }
  }

  // ---- notes -------------------------------------------------------------------------------------
  const notes: Note[] = []
  const seenNotes = new Set<string>()
  for (const s of server.notes) {
    if (pending(local, 'question_notes', s.questionId)) continue
    seenNotes.add(s.questionId)
    const mine = local.notes.find((n) => n.questionId === s.questionId)
    if (mine?.dirty && Date.parse(mine.updatedAt) >= Date.parse(s.updatedAt)) {
      notes.push(mine)
      plan.notes.push(mine)
    } else {
      notes.push({ questionId: s.questionId, body: s.body, updatedAt: s.updatedAt, dirty: false })
    }
  }
  for (const n of local.notes) {
    if (seenNotes.has(n.questionId)) continue
    if (n.dirty) {
      notes.push(n)
      plan.notes.push(n)
    }
    // not dirty and not on the server: deleted on another device.
  }

  // ---- flags -------------------------------------------------------------------------------------
  const flags: Flag[] = []
  const seenFlags = new Set<string>()
  for (const s of server.flags) {
    const key = flagKey(s.questionId, s.reason)
    if (pending(local, 'flags', key)) continue
    seenFlags.add(key)
    flags.push({ questionId: s.questionId, reason: s.reason, comment: s.comment, createdAt: s.createdAt, synced: true })
  }
  for (const f of local.flags) {
    if (seenFlags.has(flagKey(f.questionId, f.reason))) continue
    if (!f.synced) {
      flags.push(f)
      plan.flags.push(f)
    }
  }

  return { data: { ...local, collections, bookmarks, notes, flags }, plan }
}

// ---- marking rows as sent ---------------------------------------------------------------------------
// Each takes the CURRENT data (the student may have edited while the upload ran) and only marks a row
// if it is still exactly what was uploaded.

export const markCollectionsSynced = (d: UserData, sent: readonly Collection[]): UserData => ({
  ...d,
  collections: d.collections.map((c) => (sent.some((s) => s.id === c.id && s.name === c.name) ? { ...c, synced: true } : c)),
})

export const markBookmarksSynced = (d: UserData, sent: readonly Bookmark[]): UserData => ({
  ...d,
  bookmarks: d.bookmarks.map((b) => (sent.some((s) => s.questionId === b.questionId && s.collectionId === b.collectionId) ? { ...b, synced: true } : b)),
})

export const markNotesSynced = (d: UserData, sent: readonly Note[]): UserData => ({
  ...d,
  notes: d.notes.map((n) => (sent.some((s) => s.questionId === n.questionId && s.updatedAt === n.updatedAt) ? { ...n, dirty: false } : n)),
})

export const markFlagsSynced = (d: UserData, sent: readonly Flag[]): UserData => ({
  ...d,
  flags: d.flags.map((f) => (sent.some((s) => s.questionId === f.questionId && s.reason === f.reason) ? { ...f, synced: true } : f)),
})

export const clearOutbox = (d: UserData, done: readonly OutboxItem[]): UserData => ({
  ...d,
  outbox: d.outbox.filter((o) => !done.some((x) => x.table === o.table && x.key === o.key)),
})
