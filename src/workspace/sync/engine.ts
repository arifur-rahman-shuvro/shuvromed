import type { StoredRow } from '../store/types'
import type { WorkspaceStore } from '../store/store'
import { fromServer, mergePull, pushOrder } from './merge'
import { PAGE_SIZE, type ServerRow, type WorkspaceRemote } from './remote'

export interface WorkspaceSyncReport {
  at: string
  pulled: number
  pushed: number
  removed: number
  rejected: number
  /** Stopped early because the network or server was unavailable; everything unsent stays queued. */
  offline: boolean
  errors: string[]
}

/**
 * One two-way sync. Order: read from the server and merge, then send local changes. It never throws, never
 * discards unsent local data, and can be run again at any time (every step is safe to repeat).
 */
export async function runWorkspaceSync(store: WorkspaceStore, remote: WorkspaceRemote, now: () => Date = () => new Date()): Promise<WorkspaceSyncReport> {
  const report: WorkspaceSyncReport = { at: now().toISOString(), pulled: 0, pushed: 0, removed: 0, rejected: 0, offline: false, errors: [] }
  const specs = [...store.specs.values()].sort((a, b) => a.order - b.order)

  // ---- 1. read ----
  for (const spec of specs) {
    const since = spec.mode === 'cursor' ? (await store.backend.getMeta<string | null>(`cursor/${spec.name}`)) ?? null : null
    const rows: ServerRow[] = []
    let ok = true
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await remote.fetchPage(spec.name, { since, offset, limit: PAGE_SIZE })
      if (!page.ok) { ok = false; report.errors.push(`Reading ${spec.name}: ${page.message}`); if (page.transient) report.offline = true; break }
      rows.push(...page.rows)
      if (page.rows.length < PAGE_SIZE) break
    }
    if (!ok && spec.mode === 'full') continue // a partial read of a full table is never applied
    await store.run(async () => {
      const local = await store.backend.getAll(spec.name)
      const { put, del } = mergePull(spec.name, spec, local, rows, ok)
      const changed = put.filter((p) => { const l = local.find((x) => x.id === p.id); return !l || l.dirty === null || JSON.stringify(l.v) !== JSON.stringify(p.v) }).length
      await store.backend.putMany(put)
      await store.backend.deleteMany(spec.name, del)
      report.pulled += changed
      report.removed += del.length
      if (spec.mode === 'cursor' && rows.length) await store.backend.setMeta(`cursor/${spec.name}`, rows[rows.length - 1].updated_at)
      if (put.length || del.length) store.emit()
    })
  }

  // ---- 2. send ----
  const dirty = await store.backend.dirty()
  if (dirty.length) {
    const all = new Map<string, StoredRow[]>()
    for (const s of specs) all.set(s.name, await store.backend.getAll(s.name))
    // Changes the server already refused wait for the owner to edit or discard them; they are not retried forever.
    const { upserts, deletes } = pushOrder(store.specs, dirty.filter((r) => !r.rejected), all)
    const reject = (r: StoredRow, message: string) => store.run(async () => {
      const cur = await store.backend.get(r.table, r.id)
      if (cur) await store.backend.putMany([{ ...cur, rejected: message }])
      report.rejected++
      report.errors.push(`${r.table}: ${message}`)
      store.emit()
    })
    const ack = (r: StoredRow, server: ServerRow | null) => store.run(async () => {
      const cur = await store.backend.get(r.table, r.id)
      if (!cur) return
      if (!server) { await store.backend.putMany([{ ...cur, base: null }]); return }
      const fresh = fromServer(r.table, server)
      if (cur.rev === r.rev) await store.backend.putMany([{ ...fresh, rev: cur.rev }])
      else await store.backend.putMany([{ ...cur, base: server.updated_at }]) // edited again while sending: keep that edit queued
      report.pushed++
    })

    outer: {
      for (const r of upserts) {
        const spec = store.specs.get(r.table)
        if (!spec) continue
        const cols = Object.fromEntries(spec.columns.filter((c) => c in r.v).map((c) => [c, r.v[c]]))
        let res = r.base === null ? await remote.insert(r.table, { id: r.id, ...cols }) : await remote.update(r.table, r.id, cols)
        // The server no longer has it (update) or already has it (an earlier send whose answer was lost): switch method once.
        if (res.ok && res.row === null) res = await remote.insert(r.table, { id: r.id, ...cols })
        else if (!res.ok && res.code === '23505' && r.base === null) {
          const again = await remote.update(r.table, r.id, cols)
          if (again.ok && again.row) res = again
        }
        if (res.ok) await ack(r, res.row)
        else if (res.transient) { report.offline = true; report.errors.push(`Sending ${r.table}: ${res.message}`); break outer }
        else await reject(r, res.message)
      }
      for (const r of deletes) {
        const res = await remote.remove(r.table, r.id)
        if (res.ok) await store.run(async () => { const cur = await store.backend.get(r.table, r.id); if (cur && cur.rev === r.rev) { await store.backend.deleteMany(r.table, [r.id]); report.pushed++; store.emit() } })
        else if (res.transient) { report.offline = true; report.errors.push(`Sending ${r.table}: ${res.message}`); break outer }
        else await reject(r, res.message)
      }
    }
  }

  await store.backend.setMeta('lastSyncAt', report.at)
  return report
}
