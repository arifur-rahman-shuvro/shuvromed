import type { Cols } from '../workspace/store/types'
import type { PageResult, ServerRow, WorkspaceRemote, WriteResult } from '../workspace/sync/remote'
import { normName } from '../workspace/model'

export interface FakeServer extends WorkspaceRemote {
  tables: Map<string, Map<string, ServerRow>>
  /** Simulate the network being down. */
  down: boolean
  /** Fail the next N writes with a rule violation. */
  refuse: { code: string; message: string } | null
  calls: string[]
  /** Change a row as another device would. */
  external(table: string, id: string, patch: Cols, at?: string): void
  externalInsert(table: string, row: Cols, at?: string): ServerRow
  externalDelete(table: string, id: string): void
  /** Lose the answer of the next successful insert (the row is saved but the device never hears back). */
  loseNextAck: boolean
}

/** An in-memory stand-in for the Supabase tables: ids, server timestamps, row_version and the unique-name rule. */
export function fakeServer(tick: () => string = (() => { let n = 0; return () => new Date(Date.UTC(2026, 10, 8, 12, 0, ++n)).toISOString() })()): FakeServer {
  const tables = new Map<string, Map<string, ServerRow>>()
  const t = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) as Map<string, ServerRow> }
  const downErr = { ok: false as const, message: 'Failed to fetch', transient: true }
  const s: FakeServer = {
    tables, down: false, refuse: null, calls: [], loseNextAck: false,
    async fetchPage(table, { since, offset, limit }): Promise<PageResult> {
      s.calls.push(`fetch ${table}`)
      if (s.down) return { ok: false, message: 'Failed to fetch', transient: true }
      const rows = [...t(table).values()].filter((r) => !since || r.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
      return { ok: true, rows: rows.slice(offset, offset + limit).map((r) => ({ ...r })) }
    },
    async insert(table, row): Promise<WriteResult> {
      s.calls.push(`insert ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      const id = String(row.id)
      if (t(table).has(id)) return { ok: false, message: 'duplicate key', code: '23505', transient: false }
      if ((table === 'user_subjects' || table === 'user_topics') && [...t(table).values()].some((r) => normName(String(r.name)) === normName(String(row.name)) && (table === 'user_subjects' || (r.subject_id === row.subject_id && (r.parent_id ?? null) === (row.parent_id ?? null))))) {
        return { ok: false, message: 'duplicate key value violates unique constraint', code: '23505', transient: false }
      }
      const at = tick()
      const saved: ServerRow = { owner_id: 'me', created_at: at, row_version: 1, ...row, id, updated_at: at }
      t(table).set(id, saved)
      if (s.loseNextAck) { s.loseNextAck = false; return downErr }
      return { ok: true, row: { ...saved } }
    },
    async update(table, id, patch): Promise<WriteResult> {
      s.calls.push(`update ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      const cur = t(table).get(id)
      if (!cur) return { ok: true, row: null }
      const saved: ServerRow = { ...cur, ...patch, id, updated_at: tick(), row_version: Number(cur.row_version) + 1 }
      t(table).set(id, saved)
      return { ok: true, row: { ...saved } }
    },
    async remove(table, id) {
      s.calls.push(`remove ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      t(table).delete(id)
      return { ok: true }
    },
    external(table, id, patch, at) {
      const cur = t(table).get(id) as ServerRow
      t(table).set(id, { ...cur, ...patch, updated_at: at ?? tick(), row_version: Number(cur.row_version) + 1 })
    },
    externalInsert(table, row, at) {
      const when = at ?? tick()
      const saved: ServerRow = { owner_id: 'me', created_at: when, row_version: 1, id: `ext-${t(table).size + 1}`, ...row, updated_at: when } as ServerRow
      t(table).set(saved.id, saved)
      return saved
    },
    externalDelete(table, id) { t(table).delete(id) },
  }
  return s
}
