import type { Backend, Cols, StoredRow, TableSpec } from './types'

export type Row = Cols & { id: string }
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
