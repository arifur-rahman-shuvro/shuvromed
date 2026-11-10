import type { Backend, StoredRow } from './types'

const DB_VERSION = 1
export const dbName = (userId: string) => `shuvromed-workspace-v1-${userId}`

type Rec = StoredRow & { key: string; isDirty?: 1 }

const done = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted')) })

function toRow(r: Rec): StoredRow {
  const { key: _k, isDirty: _d, ...row } = r
  void _k; void _d
  return row
}

/** One IndexedDB database per signed-in user, so accounts on a shared phone never see each other's data. */
export async function openIdbBackend(userId: string, factory: IDBFactory = indexedDB): Promise<Backend> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(dbName(userId), DB_VERSION)
    open.onupgradeneeded = () => {
      const d = open.result
      const rows = d.createObjectStore('rows', { keyPath: 'key' })
      rows.createIndex('table', 'table')
      rows.createIndex('dirty', 'isDirty')
      d.createObjectStore('meta')
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('Database is blocked by another tab'))
  })
  const store = (name: 'rows' | 'meta', mode: IDBTransactionMode = 'readonly') => db.transaction(name, mode).objectStore(name)
  return {
    persistent: true,
    async getAll(table) {
      const recs = await done(store('rows').index('table').getAll(table) as IDBRequest<Rec[]>)
      return recs.map(toRow)
    },
    async get(table, id) {
      const rec = await done(store('rows').get(`${table}/${id}`) as IDBRequest<Rec | undefined>)
      return rec ? toRow(rec) : undefined
    },
    async getMany(table, ids) {
      if (!ids.length) return []
      const os = db.transaction('rows', 'readonly').objectStore('rows')
      const recs = await Promise.all(ids.map((id) => done(os.get(`${table}/${id}`) as IDBRequest<Rec | undefined>)))
      return recs.filter((r): r is Rec => !!r).map(toRow)
    },
    async putMany(list) {
      if (!list.length) return
      const tx = db.transaction('rows', 'readwrite')
      const os = tx.objectStore('rows')
      for (const r of list) {
        const rec: Rec = { ...r, key: `${r.table}/${r.id}` }
        if (r.dirty) rec.isDirty = 1
        os.put(rec)
      }
      await finished(tx)
    },
    async deleteMany(table, ids) {
      if (!ids.length) return
      const tx = db.transaction('rows', 'readwrite')
      for (const id of ids) tx.objectStore('rows').delete(`${table}/${id}`)
      await finished(tx)
    },
    async dirty() {
      const recs = await done(store('rows').index('dirty').getAll(1) as IDBRequest<Rec[]>)
      return recs.map(toRow)
    },
    async getMeta<T>(k: string) { return (await done(store('meta').get(k))) as T | undefined },
    async setMeta(k, value) {
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put(value, k)
      await finished(tx)
    },
    async clear() {
      const tx = db.transaction(['rows', 'meta'], 'readwrite')
      tx.objectStore('rows').clear()
      tx.objectStore('meta').clear()
      await finished(tx)
    },
    close() { db.close() },
  }
}

/** Removes a user's whole on-device workspace (account deletion). Best effort. */
export function deleteIdbDatabase(userId: string, factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<void> {
  if (!factory) return Promise.resolve()
  return new Promise((resolve) => {
    const req = factory.deleteDatabase(dbName(userId))
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
