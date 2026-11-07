import { addAttempts, loadAttempts } from '../practice/attempts'
import { loadUserData, updateUserData } from '../userdata/store'
import { clearOutbox, markBookmarksSynced, markCollectionsSynced, markFlagsSynced, markNotesSynced, reconcile } from './merge'
import { CHUNK, type SyncRemote } from './remote'

export interface SyncReport {
  at: string
  attemptsPushed: number
  attemptsPulled: number
  errors: string[]
}

/**
 * One full two-way sync for one signed-in user. It never throws: every failure is collected in
 * `errors`, local data is never discarded, and anything not sent stays queued for the next run.
 */
export async function runSync(userId: string, remote: SyncRemote, now: () => Date = () => new Date()): Promise<SyncReport> {
  const report: SyncReport = { at: now().toISOString(), attemptsPushed: 0, attemptsPulled: 0, errors: [] }
  const fail = (what: string, error: string) => report.errors.push(`${what}: ${error}`)
  const save = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) fail('Saving on this device', r.error ?? 'failed')
  }

  // ---- 1. answers: pull what other devices uploaded ----------------------------------------------
  const since = loadUserData(userId).lastSyncAt
  const pulled = await remote.fetchAttempts(since)
  const pulledIds: string[] = []
  if (pulled.ok) {
    // createdAt is the server's receipt time, used only to decide where to resume; it is not part of an attempt.
    const added = addAttempts(userId, pulled.value.map(({ createdAt: _receivedAt, ...attempt }) => attempt))
    save(added)
    report.attemptsPulled = added.added
    pulledIds.push(...pulled.value.map((a) => a.id))
    const newest = pulled.value.reduce<string | null>((m, a) => (m === null || a.createdAt > m ? a.createdAt : m), null)
    save(updateUserData(userId, (d) => ({
      ...d,
      syncedAttemptIds: [...new Set([...d.syncedAttemptIds, ...pulledIds])],
      lastSyncAt: newest && (!d.lastSyncAt || newest > d.lastSyncAt) ? newest : d.lastSyncAt,
    })))
  } else fail('Downloading answers', pulled.error)

  // ---- 2. answers: push what only this device has -------------------------------------------------
  const known = new Set(loadUserData(userId).syncedAttemptIds)
  const unsent = loadAttempts(userId).filter((a) => !known.has(a.id))
  for (let i = 0; i < unsent.length; i += CHUNK) {
    const part = unsent.slice(i, i + CHUNK)
    const r = await remote.pushAttempts(part)
    if (!r.ok) {
      fail('Uploading answers', r.error)
      break
    }
    report.attemptsPushed += part.length
    save(updateUserData(userId, (d) => ({ ...d, syncedAttemptIds: [...new Set([...d.syncedAttemptIds, ...part.map((a) => a.id)])] })))
  }

  // ---- 3. bookmarks, collections, notes, flags ----------------------------------------------------
  const snap = await remote.fetchSnapshot()
  if (!snap.ok) {
    fail('Downloading bookmarks and notes', snap.error)
    return report
  }
  let plan = reconcile(loadUserData(userId), snap.value).plan
  save(updateUserData(userId, (d) => {
    const out = reconcile(d, snap.value)
    plan = out.plan
    return out.data
  }))

  const collections = await remote.pushCollections(plan.collections)
  if (collections.ok) save(updateUserData(userId, (d) => markCollectionsSynced(d, plan.collections)))
  else fail('Uploading collections', collections.error)

  if (collections.ok) {
    const r = await remote.pushBookmarks(plan.bookmarks)
    if (r.ok) save(updateUserData(userId, (d) => markBookmarksSynced(d, plan.bookmarks)))
    else fail('Uploading bookmarks', r.error)
  } // otherwise bookmarks wait: they may point at a collection the server does not have yet

  const notes = await remote.pushNotes(plan.notes)
  if (notes.ok) save(updateUserData(userId, (d) => markNotesSynced(d, plan.notes)))
  else fail('Uploading notes', notes.error)

  const flags = await remote.pushFlags(plan.flags)
  if (flags.ok) save(updateUserData(userId, (d) => markFlagsSynced(d, plan.flags)))
  else fail('Uploading reports', flags.error)

  if (plan.deletes.length > 0) {
    const r = await remote.deleteRows(plan.deletes)
    if (r.ok) save(updateUserData(userId, (d) => clearOutbox(d, plan.deletes)))
    else fail('Removing deleted items', r.error)
  }
  return report
}
