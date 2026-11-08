import type { Backend, StoredRow } from './types'

/** In-memory backend: used by tests and as the fallback when IndexedDB is unavailable (e.g. some private windows). */
export function memoryBackend(persistent = false): Backend {
  const rows = new Map<string, StoredRow>()
  const meta = new Map<string, unknown>()
  const key = (t: string, id: string) => `${t}/${id}`
  const clone = <T,>(x: T): T => structuredClone(x)
  return {
    persistent,
    async getAll(table) { return [...rows.values()].filter((r) => r.table === table).map(clone) },
    async get(table, id) { const r = rows.get(key(table, id)); return r ? clone(r) : undefined },
    async putMany(list) { for (const r of list) rows.set(key(r.table, r.id), clone(r)) },
    async deleteMany(table, ids) { for (const id of ids) rows.delete(key(table, id)) },
    async dirty() { return [...rows.values()].filter((r) => r.dirty !== null).map(clone) },
    async getMeta<T>(k: string) { return meta.get(k) as T | undefined },
    async setMeta(k, value) { meta.set(k, clone(value)) },
    async clear() { rows.clear(); meta.clear() },
    close() { /* nothing to release */ },
  }
}
