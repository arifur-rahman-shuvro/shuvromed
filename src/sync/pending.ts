import type { Attempt } from '../practice/attempts'
import type { UserData } from '../userdata/model'

/** How many things exist only on this device (or are deletions the server has not heard about). */
export function pendingCount(attempts: readonly Attempt[], d: UserData): number {
  const sent = new Set(d.syncedAttemptIds)
  return (
    attempts.filter((a) => !sent.has(a.id)).length +
    d.collections.filter((c) => !c.synced).length +
    d.bookmarks.filter((b) => !b.synced).length +
    d.notes.filter((n) => n.dirty).length +
    d.flags.filter((f) => !f.synced).length +
    d.outbox.length
  )
}
