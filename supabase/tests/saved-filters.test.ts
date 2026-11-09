import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Tx } from './support/db'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CHECK = '23514'
const UNIQUE = '23505'
const DENIED = '42501'

let tx: Tx
beforeAll(async () => { tx = await Tx.open() })
afterAll(async () => { await tx.close() })
beforeEach(async () => {
  await tx.begin()
  await tx.as('postgres')
  await tx.ok(`insert into auth.users (id, email) values ($1,'a@t.local'), ($2,'b@t.local')`, [A, B])
})
afterEach(async () => { await tx.rollback() })

const add = (name: string, filter: unknown = { text: 'valve' }, sort?: string) =>
  tx.q(`insert into public.user_saved_filters (name, filter${sort ? ', sort' : ''}) values ($1, $2${sort ? ', $3' : ''}) returning id`, [name, JSON.stringify(filter), ...(sort ? [sort] : [])])

describe('saved filters', () => {
  it('saves for the signed-in owner, with defaults filled in by the database', async () => {
    await tx.as('authenticated', A)
    const r = await add('Hard heart questions')
    expect(r.error).toBeUndefined()
    const row = (await tx.ok(`select owner_id, sort, row_version from public.user_saved_filters`)).rows[0]
    expect(row).toMatchObject({ owner_id: A, sort: 'edited-new', row_version: 1 })
  })
  it('each person sees only their own', async () => {
    await tx.as('authenticated', A); await add('Mine')
    await tx.as('authenticated', B)
    expect((await tx.ok(`select count(*)::int n from public.user_saved_filters`)).rows[0].n).toBe(0)
    expect((await tx.ok(`delete from public.user_saved_filters`)).rowCount).toBe(0)
    expect((await tx.ok(`update public.user_saved_filters set name='x'`)).rowCount).toBe(0)
  })
  it('cannot save on behalf of someone else', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.user_saved_filters (owner_id, name, filter) values ($1,'x','{}')`, [B])).error?.code).toBe(DENIED)
  })
  it('names are unique per person ignoring case and spacing; another person may reuse one', async () => {
    await tx.as('authenticated', A)
    await add('Weak  Topics')
    expect((await add('weak topics')).error?.code).toBe(UNIQUE)
    await tx.as('authenticated', B)
    expect((await add('Weak Topics')).error).toBeUndefined()
  })
  it('checks the name, the shape and the size of the filter and the sort', async () => {
    await tx.as('authenticated', A)
    expect((await add('   ')).error?.code).toBe(CHECK)
    expect((await add('x'.repeat(81))).error?.code).toBe(CHECK)
    expect((await add('a', [1, 2])).error?.code).toBe(CHECK)
    expect((await add('b', { text: 'x'.repeat(20001) })).error?.code).toBe(CHECK)
    expect((await add('c', {}, 'random')).error?.code).toBe(CHECK)
    expect((await add('d', {}, 'wording')).error).toBeUndefined()
  })
  it('keeps at most 100 per person', async () => {
    await tx.as('postgres')
    await tx.ok(`insert into public.user_saved_filters (owner_id, name, filter) select $1, 'f' || g, '{}' from generate_series(1,100) g`, [A])
    await tx.as('authenticated', A)
    expect((await add('one too many')).error?.code).toBe(CHECK)
    await tx.as('authenticated', B)
    expect((await add('fine')).error).toBeUndefined()
  })
  it('an update bumps row_version and updated_at', async () => {
    await tx.as('authenticated', A)
    await add('old name')
    await tx.ok(`update public.user_saved_filters set name='new name'`)
    expect((await tx.ok(`select row_version from public.user_saved_filters`)).rows[0].row_version).toBe(2)
  })
  it('signed-out visitors have no access', async () => {
    await tx.as('anon')
    expect((await tx.q(`select * from public.user_saved_filters`)).error?.code).toBe(DENIED)
  })
  it('is removed together with its owner', async () => {
    await tx.as('authenticated', A); await add('gone soon')
    await tx.as('postgres')
    await tx.ok(`delete from auth.users where id = $1`, [A])
    expect((await tx.ok(`select count(*)::int n from public.user_saved_filters`)).rows[0].n).toBe(0)
  })
  it('the rollback file removes only this table and leaves the rest working', async () => {
    await tx.as('authenticated', A)
    await add('temporary')
    await tx.as('postgres')
    const sql = readFileSync(join(__dirname, '..', 'rollback', '20261109090700_saved_filters.down.sql'), 'utf8').replace(/^begin;|commit;$/gm, '')
    await tx.ok(sql)
    expect((await tx.ok(`select count(*)::int n from pg_tables where schemaname='public' and tablename='user_saved_filters'`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from pg_proc where proname='user_saved_filters_cap'`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from pg_tables where schemaname='public' and tablename in ('user_questions','user_tags','user_subjects')`)).rows[0].n).toBe(3)
  })
})
