/** On-device store for the private workspace (v3.0 Phase 3). Rows mirror the server tables (snake_case columns). */

export type Cols = Record<string, unknown>

export interface TableSpec {
  name: string
  /** Parents before children: pushed in ascending order, deleted in descending order. */
  order: number
  /** `full`: every sync reads the whole table (small tables; also detects remote deletes by absence).
   *  `cursor`: reads only rows changed since the last sync (large tables; deletes arrive as a `deleted_at` tombstone). */
  mode: 'full' | 'cursor'
  /** Columns the client may write. Server-managed columns (row_version, updated_at, created_at, owner_id) are never sent. */
  columns: string[]
  /** Self-reference (nested tables): parents are pushed before children and deleted after them. */
  parentKey?: string
  /** A link table with no `id`/`updated_at` columns (a pair of ids). A row's id is its key values joined by ":".
   *  Links are only ever added or removed, never changed. */
  key?: string[]
  /** A link table read per parent: after the parent table is read, only the links of the parent rows that changed
   *  are read (the server marks a question as changed whenever its links change). */
  childOf?: { table: string; fk: string }
  /** The server table may not exist yet (its migration is waiting for approval). While it is missing, sync skips it quietly
   *  and the changes wait on the device; once the table exists they are sent with no change to the app. */
  optionalRemote?: boolean
}

export interface StoredRow {
  table: string
  id: string
  v: Cols
  /** Not yet on the server: a new/changed row (`upsert`) or a removal (`delete`). */
  dirty: 'upsert' | 'delete' | null
  /** Counts local edits, so a sync that finishes after a newer edit never overwrites it. */
  rev: number
  /** When the owner last changed it on this device (ISO). Decides "newest edit wins". */
  editedAt: string | null
  /** The server's `updated_at` when last seen; null while the row has never reached the server. */
  base: string | null
  /** The server refused this change for good (a rule, not a network problem). */
  rejected: string | null
}

export interface Backend {
  readonly persistent: boolean
  getAll(table: string): Promise<StoredRow[]>
  get(table: string, id: string): Promise<StoredRow | undefined>
  putMany(rows: StoredRow[]): Promise<void>
  deleteMany(table: string, ids: string[]): Promise<void>
  dirty(): Promise<StoredRow[]>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  clear(): Promise<void>
  close(): void
}
