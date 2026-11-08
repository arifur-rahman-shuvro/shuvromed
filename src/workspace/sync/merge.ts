import type { Cols, StoredRow, TableSpec } from '../store/types'
import type { ServerRow } from './remote'

const ms = (iso: string | null): number => (iso ? new Date(iso).getTime() : 0)

const SERVER_ONLY = new Set(['owner_id'])
export const fromServer = (table: string, r: ServerRow): StoredRow => {
  const v: Cols = {}
  for (const [k, val] of Object.entries(r)) if (!SERVER_ONLY.has(k) && k !== 'id') v[k] = val
  return { table, id: r.id, v, dirty: null, rev: 0, editedAt: null, base: r.updated_at, rejected: null }
}

/**
 * Decides what the device keeps after reading from the server. "Newest edit wins" per row:
 * a local change newer than the server's copy is kept and sent later; otherwise the server's copy replaces it.
 * Rows the server no longer has are only removed when `complete` is true (every page was read), so a dropped
 * connection halfway through can never delete local data.
 */
export function mergePull(
  table: string,
  spec: TableSpec,
  local: StoredRow[],
  remote: ServerRow[],
  complete: boolean,
): { put: StoredRow[]; del: string[] } {
  const byId = new Map(local.map((r) => [r.id, r]))
  const put: StoredRow[] = []
  const del: string[] = []
  const seen = new Set<string>()
  for (const r of remote) {
    seen.add(r.id)
    const l = byId.get(r.id)
    if (!l) { put.push(fromServer(table, r)); continue }
    if (l.dirty === null) {
      if (l.base !== r.updated_at) put.push(fromServer(table, r))
      continue
    }
    if (ms(l.editedAt) > ms(r.updated_at)) {
      if (l.base !== r.updated_at) put.push({ ...l, base: r.updated_at }) // keep the local change, send it over the server's version
    } else {
      put.push(fromServer(table, r)) // the server's copy is newer: it wins
    }
  }
  if (complete && spec.mode === 'full') {
    for (const l of local) {
      if (seen.has(l.id)) continue
      if (l.base === null) continue // not sent yet
      if (l.dirty === 'upsert') put.push({ ...l, base: null, rejected: null }) // removed elsewhere but edited here: send it again
      else del.push(l.id) // removed on the server (or removed here too)
    }
  }
  return { put, del }
}

/** Order rows for sending: parents first (and tables in order); removals run last, children first. */
export function pushOrder(specs: Map<string, TableSpec>, dirty: StoredRow[], allByTable: Map<string, StoredRow[]>): { upserts: StoredRow[]; deletes: StoredRow[] } {
  const depth = (r: StoredRow): number => {
    const key = specs.get(r.table)?.parentKey
    if (!key) return 0
    const rows = new Map((allByTable.get(r.table) ?? []).map((x) => [x.id, x]))
    let d = 0
    let cur: StoredRow | undefined = r
    const seen = new Set<string>()
    while (cur && cur.v[key] && !seen.has(cur.id)) {
      seen.add(cur.id)
      d++
      cur = rows.get(String(cur.v[key]))
    }
    return d
  }
  const ord = (r: StoredRow) => specs.get(r.table)?.order ?? 0
  const withKey = dirty.map((r) => ({ r, o: ord(r), d: depth(r) }))
  const upserts = withKey.filter((x) => x.r.dirty === 'upsert').sort((a, b) => a.o - b.o || a.d - b.d).map((x) => x.r)
  const deletes = withKey.filter((x) => x.r.dirty === 'delete').sort((a, b) => b.o - a.o || b.d - a.d).map((x) => x.r)
  return { upserts, deletes }
}
