import type { StoredRow } from '../store/types'
import type { WorkspaceStore } from '../store/store'
import { fromServer, mergeChildren, mergePull, pushOrder } from './merge'
import { CHILD_CHUNK, isMissingTable, PAGE_SIZE, type ServerRow, type WorkspaceRemote } from './remote'

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
  /** Rows that were new or changed on the server in this run, per table (their links are read next). */
  const changedFromServer = new Map<string, Set<string>>()
  /** Optional tables the server does not have yet: skipped, and their changes wait. */
  const missing = new Set<string>()
  for (const spec of specs) {
    if (spec.childOf) {
      // Parents whose links could not be read last time are read again now.
      const pendingKey = `links-pending/${spec.name}`
      const prior = (await store.backend.getMeta<string[]>(pendingKey)) ?? []
      const parents = [...new Set([...prior, ...(changedFromServer.get(spec.childOf.table) ?? [])])]
      const rows: ServerRow[] = []
      let ok = true
      for (let i = 0; i < parents.length && ok; i += CHILD_CHUNK) {
        const page = await remote.fetchChildren(spec.name, spec.childOf.fk, parents.slice(i, i + CHILD_CHUNK), spec.key ?? [])
        if (!page.ok) { ok = false; report.errors.push(`Reading ${spec.name}: ${page.message}`); if (page.transient) report.offline = true; break }
        rows.push(...page.rows)
      }
      // Links of the parents that were read are replaced only when every chunk was read.
      if (!ok) { await store.backend.setMeta(pendingKey, parents); continue }
      await store.backend.setMeta(pendingKey, [])
      await store.run(async () => {
        const local = await store.backend.getAll(spec.name)
        const { put, del } = mergeChildren(spec.childOf!.fk, local, rows, new Set(parents))
        const rowsPut = put.map((p) => ({ ...p, table: spec.name }))
        await store.backend.putMany(rowsPut)
        await store.backend.deleteMany(spec.name, del)
        report.pulled += rowsPut.length
        report.removed += del.length
        if (rowsPut.length || del.length) store.emit()
      })
      continue
    }
    if (spec.requires && missing.has(spec.requires)) { missing.add(spec.name); continue } // waits for its parent table to exist
    const since = spec.mode === 'cursor' ? (await store.backend.getMeta<string | null>(`cursor/${spec.name}`)) ?? null : null
    const rows: ServerRow[] = []
    let ok = true
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await remote.fetchPage(spec.name, { since, offset, limit: PAGE_SIZE, column: spec.cursorColumn })
      if (!page.ok && spec.optionalRemote && isMissingTable(page.code)) { missing.add(spec.name); ok = false; break }
      if (!page.ok) { ok = false; report.errors.push(`Reading ${spec.name}: ${page.message}`); if (page.transient) report.offline = true; break }
      rows.push(...page.rows)
      if (page.rows.length < PAGE_SIZE) break
    }
    if (missing.has(spec.name)) continue
    if (!ok && spec.mode === 'full') continue // a partial read of a full table is never applied
    await store.run(async () => {
      const local = await store.backend.getAll(spec.name)
      const { put, del } = mergePull(spec.name, spec, local, rows, ok)
      const changed = put.filter((p) => { const l = local.find((x) => x.id === p.id); return !l || l.dirty === null || JSON.stringify(l.v) !== JSON.stringify(p.v) }).length
      await store.backend.putMany(put)
      await store.backend.deleteMany(spec.name, del)
      report.pulled += changed
      report.removed += del.length
      changedFromServer.set(spec.name, new Set(put.filter((p) => p.dirty === null).map((p) => p.id)))
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
    const { linkDeletes, upserts, deletes } = pushOrder(store.specs, dirty.filter((r) => !r.rejected && !missing.has(r.table)), all)
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

    const keyOf = (r: StoredRow): Record<string, unknown> | undefined => {
      const key = store.specs.get(r.table)?.key
      return key ? Object.fromEntries(key.map((k) => [k, r.v[k]])) : undefined
    }
    /** Returns true when the whole send must stop (network down). */
    const sendDelete = async (r: StoredRow): Promise<boolean> => {
      const res = await remote.remove(r.table, r.id, keyOf(r))
      if (res.ok) await store.run(async () => { const cur = await store.backend.get(r.table, r.id); if (cur && cur.rev === r.rev) { await store.backend.deleteMany(r.table, [r.id]); report.pushed++; store.emit() } })
      else if (res.transient) { report.offline = true; report.errors.push(`Sending ${r.table}: ${res.message}`); return true }
      else await reject(r, res.message)
      return false
    }

    outer: {
      for (const r of linkDeletes) if (await sendDelete(r)) break outer
      for (const r of upserts) {
        const spec = store.specs.get(r.table)
        if (!spec) continue
        const cols = Object.fromEntries(spec.columns.filter((c) => c in r.v).map((c) => [c, r.v[c]]))
        if (spec.key) {
          // A link: only ever added. "Already there" counts as done.
          const res = await remote.insert(r.table, cols)
          if (res.ok || res.code === '23505') await ack(r, { ...cols, id: r.id, created_at: report.at, updated_at: String((res.ok && res.row?.created_at) || report.at) } as ServerRow)
          else if (res.transient) { report.offline = true; report.errors.push(`Sending ${r.table}: ${res.message}`); break outer }
          else await reject(r, res.message)
          continue
        }
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
      for (const r of deletes) if (await sendDelete(r)) break outer
    }
  }

  await store.backend.setMeta('lastSyncAt', report.at)
  return report
}
