import { z } from 'zod'

/**
 * Everything a student keeps besides their answers: bookmarks (optionally in collections), notes and
 * question flags. This file is pure (no storage, no network) so every rule can be tested directly.
 *
 * Sync bookkeeping lives beside the data: `synced`/`dirty` say whether the server has this version,
 * and `outbox` remembers deletions that still have to reach the server.
 */
const QuestionId = z.string().min(1).max(100)
const Iso = z.iso.datetime({ offset: true })

export const FLAG_REASONS = ['incorrect', 'unclear', 'outdated', 'typo', 'other'] as const
export type FlagReason = (typeof FLAG_REASONS)[number]

export const NOTE_MAX = 5000
export const COMMENT_MAX = 1000
export const COLLECTION_NAME_MAX = 60

export const CollectionSchema = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(COLLECTION_NAME_MAX), createdAt: Iso, synced: z.boolean() })
export const BookmarkSchema = z.strictObject({ questionId: QuestionId, collectionId: z.uuid().nullable(), createdAt: Iso, synced: z.boolean() })
export const NoteSchema = z.strictObject({ questionId: QuestionId, body: z.string().min(1).max(NOTE_MAX), updatedAt: Iso, dirty: z.boolean() })
export const FlagSchema = z.strictObject({ questionId: QuestionId, reason: z.enum(FLAG_REASONS), comment: z.string().max(COMMENT_MAX).nullable(), createdAt: Iso, synced: z.boolean() })
export const OutboxSchema = z.strictObject({ table: z.enum(['bookmark_collections', 'bookmarks', 'question_notes', 'flags']), key: z.string().min(1).max(200) })

export const UserDataSchema = z.strictObject({
  collections: z.array(CollectionSchema),
  bookmarks: z.array(BookmarkSchema),
  notes: z.array(NoteSchema),
  flags: z.array(FlagSchema),
  outbox: z.array(OutboxSchema),
  syncedAttemptIds: z.array(z.uuid()),
  lastSyncAt: Iso.nullable(),
})
export type UserData = z.infer<typeof UserDataSchema>
export type Collection = z.infer<typeof CollectionSchema>
export type Bookmark = z.infer<typeof BookmarkSchema>
export type Note = z.infer<typeof NoteSchema>
export type Flag = z.infer<typeof FlagSchema>
export type OutboxItem = z.infer<typeof OutboxSchema>

export const emptyUserData = (): UserData => ({ collections: [], bookmarks: [], notes: [], flags: [], outbox: [], syncedAttemptIds: [], lastSyncAt: null })

export const flagKey = (questionId: string, reason: FlagReason) => `${questionId}|${reason}`

/** Result of an edit: the new state, or a message a student can act on. */
export type Edit = { ok: true; data: UserData } | { ok: false; error: string }
const fail = (error: string): Edit => ({ ok: false, error })
const ok = (data: UserData): Edit => ({ ok: true, data })

/** Remembers a deletion for the server, but only if the server could have the row. */
function withDelete(d: UserData, table: OutboxItem['table'], key: string, wasSynced: boolean): UserData['outbox'] {
  if (!wasSynced) return d.outbox.filter((o) => !(o.table === table && o.key === key))
  return d.outbox.some((o) => o.table === table && o.key === key) ? d.outbox : [...d.outbox, { table, key }]
}
/** Re-creating something that was deleted cancels the pending deletion. */
const withoutDelete = (d: UserData, table: OutboxItem['table'], key: string) => d.outbox.filter((o) => !(o.table === table && o.key === key))

// ---- bookmarks -----------------------------------------------------------------------------------

export const isBookmarked = (d: UserData, questionId: string) => d.bookmarks.some((b) => b.questionId === questionId)

export function toggleBookmark(d: UserData, questionId: string, nowIso: string): UserData {
  const existing = d.bookmarks.find((b) => b.questionId === questionId)
  if (existing) {
    return { ...d, bookmarks: d.bookmarks.filter((b) => b !== existing), outbox: withDelete(d, 'bookmarks', questionId, existing.synced) }
  }
  return {
    ...d,
    bookmarks: [...d.bookmarks, { questionId, collectionId: null, createdAt: nowIso, synced: false }],
    outbox: withoutDelete(d, 'bookmarks', questionId),
  }
}

export function moveBookmark(d: UserData, questionId: string, collectionId: string | null): Edit {
  if (collectionId !== null && !d.collections.some((c) => c.id === collectionId)) return fail('That collection no longer exists.')
  if (!isBookmarked(d, questionId)) return fail('Bookmark the question first.')
  return ok({ ...d, bookmarks: d.bookmarks.map((b) => (b.questionId === questionId ? { ...b, collectionId, synced: false } : b)) })
}

// ---- collections ---------------------------------------------------------------------------------

export function addCollection(d: UserData, name: string, id: string, nowIso: string): Edit {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return fail('Give the collection a name.')
  if (clean.length > COLLECTION_NAME_MAX) return fail(`Collection names can be at most ${COLLECTION_NAME_MAX} characters.`)
  if (d.collections.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return fail('You already have a collection with that name.')
  return ok({ ...d, collections: [...d.collections, { id, name: clean, createdAt: nowIso, synced: false }] })
}

/** Deleting a collection keeps its bookmarks; they just become unfiled (as the database does too). */
export function deleteCollection(d: UserData, id: string): UserData {
  const c = d.collections.find((x) => x.id === id)
  if (!c) return d
  return {
    ...d,
    collections: d.collections.filter((x) => x !== c),
    bookmarks: d.bookmarks.map((b) => (b.collectionId === id ? { ...b, collectionId: null, synced: false } : b)),
    outbox: withDelete(d, 'bookmark_collections', id, c.synced),
  }
}

// ---- notes ---------------------------------------------------------------------------------------

export const noteFor = (d: UserData, questionId: string) => d.notes.find((n) => n.questionId === questionId)

/** Saving an empty note removes it. */
export function setNote(d: UserData, questionId: string, body: string, nowIso: string): Edit {
  const text = body.trim()
  if (text.length > NOTE_MAX) return fail(`Notes can be at most ${NOTE_MAX} characters.`)
  const existing = noteFor(d, questionId)
  if (!text) {
    if (!existing) return ok(d)
    // A note is only known to the server if it was pushed; `dirty` is false for rows pulled from it as well.
    return ok({ ...d, notes: d.notes.filter((n) => n !== existing), outbox: withDelete(d, 'question_notes', questionId, true) })
  }
  const next: Note = { questionId, body: text, updatedAt: nowIso, dirty: true }
  return ok({ ...d, notes: existing ? d.notes.map((n) => (n === existing ? next : n)) : [...d.notes, next], outbox: withoutDelete(d, 'question_notes', questionId) })
}

// ---- flags ---------------------------------------------------------------------------------------

export const flagsFor = (d: UserData, questionId: string) => d.flags.filter((f) => f.questionId === questionId)

export function addFlag(d: UserData, questionId: string, reason: FlagReason, comment: string, nowIso: string): Edit {
  const text = comment.trim()
  if (text.length > COMMENT_MAX) return fail(`Comments can be at most ${COMMENT_MAX} characters.`)
  if (d.flags.some((f) => f.questionId === questionId && f.reason === reason)) return fail('You already reported this question for that reason.')
  return ok({
    ...d,
    flags: [...d.flags, { questionId, reason, comment: text || null, createdAt: nowIso, synced: false }],
    outbox: withoutDelete(d, 'flags', flagKey(questionId, reason)),
  })
}

export function removeFlag(d: UserData, questionId: string, reason: FlagReason): UserData {
  const f = d.flags.find((x) => x.questionId === questionId && x.reason === reason)
  if (!f) return d
  return { ...d, flags: d.flags.filter((x) => x !== f), outbox: withDelete(d, 'flags', flagKey(questionId, reason), f.synced) }
}
