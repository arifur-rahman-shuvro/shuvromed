import type { Backend, Cols, StoredRow, TableSpec } from './types'

export type Row = Cols & { id: string }
export type Change =
  | { table: string; id: string; create: Cols }
  | { table: string; id: string; update: Cols }
  | { table: string; id: string; remove: true }
type Listener = () => void

const uuid = (): string => crypto.randomUUID()

/**
 * The single place screens read and write workspace data. Everything is saved on the device first; the sync engine
 * sends it to the server later. Writes are serialised so two quick edits to one row can never overwrite each other.
 */
export class WorkspaceStore {
  private chain: Promise<unknown> = Promise.resolve()
  private listeners = new Set<Listener>()
  readonly specs: Map<string, TableSpec>
  readonly backend: Backend
  private clock: () => Date

  constructor(backend: Backend, specs: TableSpec[], clock: () => Date = () => new Date()) {
    this.backend = backend
    this.clock = clock
    this.specs = new Map(specs.map((s) => [s.name, s]))
  }

  has(table: string): boolean { return this.specs.has(table) }
  now(): string { return this.clock().toISOString() }
  private spec(table: string): TableSpec {
    const s = this.specs.get(table)
    if (!s) throw new Error(`Unknown table ${table}`)
    return s
  }

  /** Runs one change at a time (reads that must not interleave with a write use it too). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  emit(): void { this.listeners.forEach((l) => l()) }

  private visible = (r: StoredRow) => r.dirty !== 'delete'

  async list(table: string): Promise<Row[]> {
    this.spec(table)
    return (await this.backend.getAll(table)).filter(this.visible).map((r) => ({ ...r.v, id: r.id }))
  }
  /** Ids of rows that have changes not yet sent to the server (edits, not removals). */
  async pendingIds(table: string): Promise<Set<string>> {
    this.spec(table)
    return new Set((await this.backend.getAll(table)).filter((r) => r.dirty === 'upsert').map((r) => r.id))
  }
  async get(table: string, id: string): Promise<Row | undefined> {
    const r = await this.backend.get(table, id)
    return r && this.visible(r) ? { ...r.v, id: r.id } : undefined
  }
  async count(table: string, where?: (r: Row) => boolean): Promise<number> {
    const rows = await this.list(table)
    return where ? rows.filter(where).length : rows.length
  }

  create(table: string, values: Cols, id: string = uuid()): Promise<Row> {
    const spec = this.spec(table)
    return this.run(async () => {
      const at = this.now()
      const v: Cols = { created_at: at, updated_at: at, row_version: 0 }
      for (const c of spec.columns) if (c in values) v[c] = values[c]
      const row: StoredRow = { table, id, v, dirty: 'upsert', rev: 1, editedAt: at, base: null, rejected: null }
      await this.backend.putMany([row])
      this.emit()
      return { ...v, id }
    })
  }

  update(table: string, id: string, patch: Cols): Promise<Row> {
    const spec = this.spec(table)
    return this.run(async () => {
      const cur = await this.backend.get(table, id)
      if (!cur || cur.dirty === 'delete') throw new Error('That item no longer exists.')
      const v: Cols = { ...cur.v }
      for (const c of spec.columns) if (c in patch) v[c] = patch[c]
      const row: StoredRow = { ...cur, v, dirty: 'upsert', rev: cur.rev + 1, editedAt: this.now(), rejected: null }
      await this.backend.putMany([row])
      this.emit()
      return { ...v, id }
    })
  }

  /** Hard remove. A row that never reached the server just disappears; otherwise the removal is queued. */
  remove(table: string, id: string): Promise<void> {
    this.spec(table)
    return this.run(async () => {
      const cur = await this.backend.get(table, id)
      if (!cur) return
      if (cur.base === null) await this.backend.deleteMany(table, [id])
      else await this.backend.putMany([{ ...cur, dirty: 'delete', rev: cur.rev + 1, editedAt: this.now(), rejected: null }])
      this.emit()
    })
  }

  /**
   * Several changes saved as one: all of them or none (for example a question and its topic links), with a single
   * refresh of the screens. `create` needs an `id`; `update` and `remove` act on an existing row (or one created earlier in the same call).
   */
  apply(changes: Change[]): Promise<void> {
    return this.run(async () => {
      const at = this.now()
      const touched = new Map<string, StoredRow>()
      const gone: { table: string; id: string }[] = []
      const key = (t: string, id: string) => `${t}/${id}`
      const current = async (t: string, id: string) => touched.get(key(t, id)) ?? (await this.backend.get(t, id))
      for (const c of changes) {
        const spec = this.spec(c.table)
        if ('create' in c) {
          const prior = await current(c.table, c.id)
          if (prior && prior.dirty === 'delete' && spec.key) {
            // A link removed and put back before it was sent: the server still has it, so just cancel the removal.
            touched.set(key(c.table, c.id), { ...prior, dirty: null, rev: prior.rev + 1, editedAt: at, rejected: null })
            continue
          }
          if (prior) throw new Error('That item already exists.')
          const v: Cols = { created_at: at, updated_at: at, row_version: 0 }
          for (const col of spec.columns) if (col in c.create) v[col] = c.create[col]
          touched.set(key(c.table, c.id), { table: c.table, id: c.id, v, dirty: 'upsert', rev: 1, editedAt: at, base: null, rejected: null })
        } else if ('update' in c) {
          const cur = await current(c.table, c.id)
          if (!cur || cur.dirty === 'delete') throw new Error('That item no longer exists.')
          const v: Cols = { ...cur.v }
          for (const col of spec.columns) if (col in c.update) v[col] = c.update[col]
          touched.set(key(c.table, c.id), { ...cur, v, dirty: 'upsert', rev: cur.rev + 1, editedAt: at, rejected: null })
        } else {
          const cur = await current(c.table, c.id)
          if (!cur) continue
          if (cur.base === null) { touched.delete(key(c.table, c.id)); gone.push({ table: c.table, id: c.id }) }
          else touched.set(key(c.table, c.id), { ...cur, dirty: 'delete', rev: cur.rev + 1, editedAt: at, rejected: null })
        }
      }
      for (const g of gone) await this.backend.deleteMany(g.table, [g.id])
      await this.backend.putMany([...touched.values()])
      this.emit()
    })
  }

  async pending(): Promise<{ count: number; rejected: { table: string; id: string; message: string; label: string }[] }> {
    const dirty = await this.backend.dirty()
    return {
      count: dirty.length,
      rejected: dirty.filter((r) => r.rejected).map((r) => ({ table: r.table, id: r.id, message: r.rejected as string, label: String(r.v.name ?? r.v.stem ?? r.id) })),
    }
  }

  /** Gives up on changes the server refused: they are dropped and the next sync restores the server's version. */
  discardRejected(): Promise<number> {
    return this.run(async () => {
      const bad = (await this.backend.dirty()).filter((r) => r.rejected)
      for (const r of bad) {
        if (r.base === null) await this.backend.deleteMany(r.table, [r.id])
        else await this.backend.putMany([{ ...r, dirty: null, rejected: null, base: '1970-01-01T00:00:00.000Z', editedAt: null }])
        // Tables that only read changes since a cursor must read everything again to restore the server's copy.
        if (this.specs.get(r.table)?.mode === 'cursor') await this.backend.setMeta(`cursor/${r.table}`, null)
      }
      if (bad.length) this.emit()
      return bad.length
    })
  }
}
