import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(here, '..', '..', 'migrations')
export const SHIM_FILE = join(here, 'supabase_local_shim.sql')
export const TEST_DB = 'shuvromed_test'

/** Admin connection used to (re)create the throwaway test database. */
export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres@localhost:54329/postgres'

export function testDbUrl(): string {
  const u = new URL(ADMIN_URL)
  u.pathname = `/${TEST_DB}`
  return u.toString()
}

/** The setup drops a database, so it must never be pointed at anything but a local server. */
export function assertLocal(url: string): void {
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error(`Refusing to run destructive DB test setup against non-local host "${host}"`)
  }
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function buildTestDatabase(): Promise<void> {
  assertLocal(ADMIN_URL)
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  try {
    await admin.connect()
  } catch (e) {
    throw new Error(
      `Cannot reach local Postgres at ${ADMIN_URL}. Start it first (see docs/TESTING.md). ${(e as Error).message}`,
    )
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`)
  await admin.query(`create database ${TEST_DB}`)
  await admin.end()

  const db = new pg.Client({ connectionString: testDbUrl() })
  await db.connect()
  await db.query(readFileSync(SHIM_FILE, 'utf8'))
  for (const f of migrationFiles()) {
    try {
      await db.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`)
    }
  }
  await db.end()
}

export type QResult = {
  rows: Record<string, unknown>[]
  rowCount: number
  error?: { code?: string; message: string }
}

/**
 * One transaction per test, rolled back afterwards. Every statement runs inside a
 * savepoint so an expected error does not abort the rest of the test.
 */
export class Tx {
  private n = 0
  private constructor(private c: pg.Client) {}

  static async open(): Promise<Tx> {
    const c = new pg.Client({ connectionString: testDbUrl() })
    await c.connect()
    return new Tx(c)
  }

  async begin() {
    await this.c.query('begin')
  }
  async rollback() {
    await this.c.query('rollback')
  }
  async close() {
    await this.c.end()
  }

  /** Switch identity. 'postgres' = superuser (bypasses RLS) for seeding only. */
  async as(role: 'postgres' | 'anon' | 'authenticated' | 'service_role', uid?: string) {
    await this.c.query('reset role')
    await this.c.query(`select set_config('request.jwt.claims', $1, true)`, [
      uid ? JSON.stringify({ sub: uid, role }) : '',
    ])
    if (role !== 'postgres') await this.c.query(`set local role ${role}`)
  }

  async q(sql: string, params: unknown[] = []): Promise<QResult> {
    const sp = `sp_${this.n++}`
    await this.c.query(`savepoint ${sp}`)
    try {
      const r = await this.c.query(sql, params)
      await this.c.query(`release savepoint ${sp}`)
      return { rows: r.rows, rowCount: r.rowCount ?? 0 }
    } catch (e) {
      await this.c.query(`rollback to savepoint ${sp}`)
      const err = e as { code?: string; message: string }
      return { rows: [], rowCount: 0, error: { code: err.code, message: err.message } }
    }
  }

  /** Like q() but throws on error, for setup steps that must succeed. */
  async ok(sql: string, params: unknown[] = []): Promise<QResult> {
    const r = await this.q(sql, params)
    if (r.error) throw new Error(`Expected success but got ${r.error.code}: ${r.error.message}\n${sql}`)
    return r
  }
}
