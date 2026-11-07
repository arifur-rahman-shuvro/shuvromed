import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Tx } from './support/db'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ADMIN = '99999999-9999-4999-8999-999999999999'

const PG_RLS_VIOLATION = '42501' // also "permission denied"
const PG_CHECK = '23514'
const PG_FK = '23503'
const PG_UNIQUE = '23505'

let tx: Tx

beforeAll(async () => {
  tx = await Tx.open()
})
afterAll(async () => {
  await tx.close()
})

beforeEach(async () => {
  await tx.begin()
  await tx.as('postgres')
  await tx.ok(
    `insert into auth.users (id, email) values ($1,'a@test.local'), ($2,'b@test.local'), ($3,'admin@test.local')`,
    [A, B, ADMIN],
  )
  await tx.ok(`insert into public.admins (user_id) values ($1)`, [ADMIN])
  await tx.ok(`insert into public.subjects (id, name) values ('anatomy','Anatomy')`)
  await tx.ok(`insert into public.topics (id, subject_id, name) values ('heart','anatomy','Heart')`)
  await tx.ok(
    `insert into public.questions (id, status, subject_id, topic_id, difficulty, format, unreviewed)
     values ('demo-anat-001','published','anatomy','heart','easy','sba', false),
            ('demo-anat-002','draft','anatomy','heart','easy','sba', true)`,
  )
})
afterEach(async () => {
  await tx.rollback()
})

// ---------------------------------------------------------------------------
// Per-user tables: how to insert one valid row (user_id is added by the test)
// ---------------------------------------------------------------------------
type Spec = { table: string; cols: string; vals: string }
const USER_TABLES: Spec[] = [
  { table: 'study_sessions', cols: `kind`, vals: `'practice'` },
  { table: 'attempts', cols: `question_id, selected_option, is_correct`, vals: `'demo-anat-001','A',true` },
  { table: 'bookmark_collections', cols: `name`, vals: `'Favourites'` },
  { table: 'bookmarks', cols: `question_id`, vals: `'demo-anat-001'` },
  { table: 'question_notes', cols: `question_id, body`, vals: `'demo-anat-001','my note'` },
  { table: 'flags', cols: `question_id, reason`, vals: `'demo-anat-001','typo'` },
  { table: 'review_schedule', cols: `question_id, due_at`, vals: `'demo-anat-001', now()` },
  { table: 'user_achievements', cols: `achievement_id`, vals: `'first-answer'` },
]
const insertAs = (s: Spec, uid: string) =>
  tx.q(`insert into public.${s.table} (user_id, ${s.cols}) values ('${uid}', ${s.vals})`)

describe('signup trigger and profiles', () => {
  it('creates a profile and default preferences for every new auth user', async () => {
    await tx.as('postgres')
    const p = await tx.ok(`select id, display_name from public.profiles where id = $1`, [A])
    expect(p.rowCount).toBe(1)
    const pr = await tx.ok(`select theme, daily_goal, gamification_enabled, language from public.user_preferences where user_id = $1`, [A])
    expect(pr.rows[0]).toEqual({ theme: 'system', daily_goal: 20, gamification_enabled: true, language: 'en' })
  })

  it('trims and truncates the display name, and never fails signup on bad metadata', async () => {
    await tx.as('postgres')
    const long = 'x'.repeat(200)
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await tx.ok(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'n@test.local', $2::jsonb)`, [
      id,
      JSON.stringify({ display_name: `  ${long}  ` }),
    ])
    const r = await tx.ok(`select display_name from public.profiles where id = $1`, [id])
    expect((r.rows[0].display_name as string).length).toBeLessThanOrEqual(80)

    const id2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await tx.ok(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'blank@test.local', '{"display_name":"   "}')`, [id2])
    const r2 = await tx.ok(`select display_name from public.profiles where id = $1`, [id2])
    expect(r2.rows[0].display_name).toBeNull()
  })

  it('lets a user read and edit only their own profile', async () => {
    await tx.as('authenticated', A)
    expect((await tx.ok(`select id from public.profiles`)).rows).toEqual([{ id: A }])
    expect((await tx.ok(`update public.profiles set display_name = 'Alice' where id = $1`, [A])).rowCount).toBe(1)
    // Updating B's profile touches nothing.
    expect((await tx.ok(`update public.profiles set display_name = 'hacked' where id = $1`, [B])).rowCount).toBe(0)
    await tx.as('postgres')
    expect((await tx.ok(`select display_name from public.profiles where id = $1`, [B])).rows[0].display_name).toBeNull()
  })

  it('blocks reassigning the profile id, inserting profiles and deleting profiles', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`update public.profiles set id = $1 where id = $2`, [B, A])).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`insert into public.profiles (id) values ($1)`, [ADMIN])).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`delete from public.profiles where id = $1`, [A])).error?.code).toBe(PG_RLS_VIOLATION)
  })

  it('validates preferences', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`update public.user_preferences set daily_goal = 0 where user_id = $1`, [A])).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`update public.user_preferences set theme = 'neon' where user_id = $1`, [A])).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`update public.user_preferences set srs_config = '[1]'::jsonb where user_id = $1`, [A])).error?.code).toBe(PG_CHECK)
    expect((await tx.ok(`update public.user_preferences set daily_goal = 40, theme = 'dark' where user_id = $1`, [A])).rowCount).toBe(1)
    // B's preferences are untouchable.
    expect((await tx.ok(`update public.user_preferences set daily_goal = 500 where user_id = $1`, [B])).rowCount).toBe(0)
  })
})

describe('signed-out (anon) access', () => {
  it.each(['profiles', 'user_preferences', ...USER_TABLES.map((s) => s.table), 'backup_runs', 'admins'])(
    'anon cannot read %s',
    async (table) => {
      await tx.as('anon')
      const r = await tx.q(`select * from public.${table}`)
      expect(r.error?.code).toBe(PG_RLS_VIOLATION)
    },
  )

  it.each(USER_TABLES)('anon cannot insert into $table', async (spec) => {
    await tx.as('anon')
    const r = await tx.q(`insert into public.${spec.table} (user_id, ${spec.cols}) values ('${A}', ${spec.vals})`)
    expect(r.error?.code).toBe(PG_RLS_VIOLATION)
  })

  it('anon can read subjects, topics and ONLY published questions', async () => {
    await tx.as('anon')
    expect((await tx.ok(`select id from public.subjects`)).rowCount).toBe(1)
    expect((await tx.ok(`select id from public.topics`)).rowCount).toBe(1)
    expect((await tx.ok(`select id from public.questions`)).rows).toEqual([{ id: 'demo-anat-001' }])
  })

  it('anon cannot write the catalogue', async () => {
    await tx.as('anon')
    expect((await tx.q(`insert into public.subjects (id, name) values ('hack','Hack')`)).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`update public.questions set status = 'published'`)).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`delete from public.questions`)).error?.code).toBe(PG_RLS_VIOLATION)
  })

  it('anon cannot call delete_my_account', async () => {
    await tx.as('anon')
    expect((await tx.q(`select public.delete_my_account()`)).error?.code).toBe(PG_RLS_VIOLATION)
  })
})

describe('cross-user isolation (the user must never see or change another user data)', () => {
  it.each(USER_TABLES)('$table: B cannot read, change, delete or forge A rows', async (spec) => {
    await tx.as('authenticated', A)
    expect((await insertAs(spec, A)).error).toBeUndefined()

    // Snapshot of A's row as A sees it.
    const before = await tx.ok(`select to_jsonb(t) as r from public.${spec.table} t`)
    expect(before.rowCount).toBe(1)

    await tx.as('authenticated', B)
    // 1. cannot read
    expect((await tx.ok(`select * from public.${spec.table}`)).rowCount).toBe(0)
    // 2. cannot update (error for tables without UPDATE grant, 0 rows otherwise)
    const upd = await tx.q(`update public.${spec.table} set user_id = user_id`)
    if (!upd.error) expect(upd.rowCount).toBe(0)
    // 3. cannot delete
    const del = await tx.q(`delete from public.${spec.table}`)
    if (!del.error) expect(del.rowCount).toBe(0)
    // 4. cannot insert a row owned by A
    expect((await insertAs(spec, A)).error?.code).toBe(PG_RLS_VIOLATION)
    // 5. B can still create a row of their own
    expect((await insertAs(spec, B)).error).toBeUndefined()

    // A's data is byte-for-byte unchanged and B's row is not visible to A.
    await tx.as('authenticated', A)
    const after = await tx.ok(`select to_jsonb(t) as r from public.${spec.table} t`)
    expect(after.rows).toEqual(before.rows)
  })

  it.each(USER_TABLES.filter((s) => !['attempts', 'user_achievements', 'flags'].includes(s.table)))(
    '$table: a user cannot hand a row over to someone else by editing user_id',
    async (spec) => {
      await tx.as('authenticated', A)
      await tx.ok(`insert into public.${spec.table} (${spec.cols}) values (${spec.vals})`)
      const r = await tx.q(`update public.${spec.table} set user_id = '${B}'`)
      expect(r.error?.code).toBe(PG_RLS_VIOLATION)
    },
  )

  it.each(USER_TABLES)('$table: user_id defaults to the caller when omitted', async (spec) => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.${spec.table} (${spec.cols}) values (${spec.vals})`)
    const r = await tx.ok(`select user_id from public.${spec.table}`)
    expect(r.rows).toEqual([{ user_id: A }])
  })

  it('a request with no identity cannot insert even as the authenticated role', async () => {
    await tx.as('authenticated') // role set, but no sub claim
    const r = await tx.q(`insert into public.question_notes (question_id, body) values ('demo-anat-001','x')`)
    expect(r.error).toBeDefined() // null user_id: NOT NULL or RLS violation
    expect((await tx.ok(`select * from public.attempts`)).rowCount).toBe(0)
  })
})

describe('attempts integrity', () => {
  it('is append-only: no updates, no deletes', async () => {
    await tx.as('authenticated', A)
    const ins = await tx.ok(`insert into public.attempts (question_id, selected_option, is_correct) values ('demo-anat-001','B',false) returning id`)
    const id = ins.rows[0].id
    expect((await tx.q(`update public.attempts set is_correct = true where id = $1`, [id])).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`delete from public.attempts where id = $1`, [id])).error?.code).toBe(PG_RLS_VIOLATION)
  })

  it('rejects a duplicate submission of the same attempt id (retry safety)', async () => {
    await tx.as('authenticated', A)
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const sql = `insert into public.attempts (id, question_id, selected_option, is_correct) values ($1,'demo-anat-001','A',true)`
    expect((await tx.q(sql, [id])).error).toBeUndefined()
    expect((await tx.q(sql, [id])).error?.code).toBe(PG_UNIQUE)
    expect((await tx.ok(`select count(*)::int as n from public.attempts`)).rows[0].n).toBe(1)
  })

  it('rejects bad values', async () => {
    await tx.as('authenticated', A)
    const base = (cols: string, vals: string) => tx.q(`insert into public.attempts (${cols}) values (${vals})`)
    expect((await base('question_id, selected_option, is_correct', `'demo-anat-001','F',true`)).error?.code).toBe(PG_CHECK)
    expect((await base('question_id, selected_option, is_correct, confidence', `'demo-anat-001','A',true,6`)).error?.code).toBe(PG_CHECK)
    expect((await base('question_id, selected_option, is_correct, time_ms', `'demo-anat-001','A',true,-5`)).error?.code).toBe(PG_CHECK)
    expect((await base('question_id, selected_option, is_correct, mode', `'demo-anat-001','A',true,'cheat'`)).error?.code).toBe(PG_CHECK)
    expect((await base('question_id, selected_option, is_correct', `repeat('x',101),'A',true`)).error?.code).toBe(PG_CHECK) // id longer than 100 chars
  })

  it('cannot attach an attempt to another user study session', async () => {
    await tx.as('authenticated', B)
    const s = await tx.ok(`insert into public.study_sessions (kind) values ('practice') returning id`)
    await tx.as('authenticated', A)
    const r = await tx.q(`insert into public.attempts (question_id, selected_option, is_correct, session_id) values ('demo-anat-001','A',true,$1)`, [s.rows[0].id])
    expect(r.error?.code).toBe(PG_FK)
  })

  it('keeps the attempt but clears session_id when the session is deleted', async () => {
    await tx.as('authenticated', A)
    const s = await tx.ok(`insert into public.study_sessions (kind) values ('practice') returning id`)
    await tx.ok(`insert into public.attempts (question_id, selected_option, is_correct, session_id) values ('demo-anat-001','A',true,$1)`, [s.rows[0].id])
    await tx.ok(`delete from public.study_sessions where id = $1`, [s.rows[0].id])
    const r = await tx.ok(`select session_id from public.attempts`)
    expect(r.rows).toEqual([{ session_id: null }])
  })
})

describe('bookmarks, notes, sessions, review schedule', () => {
  it('cannot file a bookmark into another user collection', async () => {
    await tx.as('authenticated', B)
    const c = await tx.ok(`insert into public.bookmark_collections (name) values ('B stuff') returning id`)
    await tx.as('authenticated', A)
    const r = await tx.q(`insert into public.bookmarks (question_id, collection_id) values ('demo-anat-001', $1)`, [c.rows[0].id])
    expect(r.error?.code).toBe(PG_FK)
  })

  it('keeps the bookmark when its collection is deleted', async () => {
    await tx.as('authenticated', A)
    const c = await tx.ok(`insert into public.bookmark_collections (name) values ('Heart') returning id`)
    await tx.ok(`insert into public.bookmarks (question_id, collection_id) values ('demo-anat-001', $1)`, [c.rows[0].id])
    await tx.ok(`delete from public.bookmark_collections where id = $1`, [c.rows[0].id])
    expect((await tx.ok(`select collection_id from public.bookmarks`)).rows).toEqual([{ collection_id: null }])
  })

  it('prevents duplicate bookmarks and duplicate collection names per user, but not across users', async () => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.bookmarks (question_id) values ('demo-anat-001')`)
    expect((await tx.q(`insert into public.bookmarks (question_id) values ('demo-anat-001')`)).error?.code).toBe(PG_UNIQUE)
    await tx.ok(`insert into public.bookmark_collections (name) values ('Same')`)
    expect((await tx.q(`insert into public.bookmark_collections (name) values ('Same')`)).error?.code).toBe(PG_UNIQUE)
    await tx.as('authenticated', B)
    expect((await tx.q(`insert into public.bookmark_collections (name) values ('Same')`)).error).toBeUndefined()
    expect((await tx.q(`insert into public.bookmarks (question_id) values ('demo-anat-001')`)).error).toBeUndefined()
  })

  it('limits note and name lengths', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.question_notes (question_id, body) values ('demo-anat-001', $1)`, ['x'.repeat(5001)])).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.question_notes (question_id, body) values ('demo-anat-001', '')`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.bookmark_collections (name) values ($1)`, ['x'.repeat(61)])).error?.code).toBe(PG_CHECK)
  })

  it('keeps updated_at honest even if the client sends a fake value', async () => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.question_notes (question_id, body) values ('demo-anat-001','v1')`)
    await tx.ok(`update public.question_notes set body = 'v2', updated_at = '2000-01-01'`)
    const r = await tx.ok(`select updated_at > '2020-01-01' as fresh from public.question_notes`)
    expect(r.rows[0].fresh).toBe(true)
  })

  it('validates review schedule and session values', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.review_schedule (question_id, due_at, ease) values ('demo-anat-001', now(), 9)`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.review_schedule (question_id, due_at, interval_days) values ('demo-anat-001', now(), -1)`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.study_sessions (kind, started_at, ended_at) values ('practice', now(), now() - interval '1 hour')`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.study_sessions (kind) values ('sleeping')`)).error?.code).toBe(PG_CHECK)
  })
})

describe('flags', () => {
  it('lets a user report an issue but not mark it resolved', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.flags (question_id, reason, status) values ('demo-anat-001','typo','resolved')`)).error?.code).toBe(PG_RLS_VIOLATION)
    await tx.ok(`insert into public.flags (question_id, reason) values ('demo-anat-001','typo')`)
    expect((await tx.ok(`update public.flags set status = 'resolved'`)).rowCount).toBe(0)
    await tx.as('postgres')
    expect((await tx.ok(`select status from public.flags`)).rows).toEqual([{ status: 'open' }])
  })

  it('lets admins read all flags and resolve them; other users cannot see them', async () => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.flags (question_id, reason) values ('demo-anat-001','incorrect')`)
    await tx.as('authenticated', B)
    expect((await tx.ok(`select * from public.flags`)).rowCount).toBe(0)
    await tx.as('authenticated', ADMIN)
    expect((await tx.ok(`select * from public.flags`)).rowCount).toBe(1)
    expect((await tx.ok(`update public.flags set status = 'resolved'`)).rowCount).toBe(1)
  })
})

describe('admin role and catalogue writes', () => {
  it('is_admin() is true only for allow-listed users', async () => {
    await tx.as('authenticated', ADMIN)
    expect((await tx.ok(`select public.is_admin() as a`)).rows[0].a).toBe(true)
    await tx.as('authenticated', A)
    expect((await tx.ok(`select public.is_admin() as a`)).rows[0].a).toBe(false)
    await tx.as('anon')
    expect((await tx.ok(`select public.is_admin() as a`)).rows[0].a).toBe(false)
  })

  it('users cannot read or write the admins table (no self-promotion)', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`select * from public.admins`)).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`insert into public.admins (user_id) values ($1)`, [A])).error?.code).toBe(PG_RLS_VIOLATION)
    await tx.as('authenticated', A)
    expect((await tx.ok(`select public.is_admin() as a`)).rows[0].a).toBe(false)
  })

  it('non-admin signed-in users cannot write the catalogue', async () => {
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.subjects (id, name) values ('hack','Hack')`)).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.ok(`update public.questions set difficulty = 'hard'`)).rowCount).toBe(0)
    expect((await tx.ok(`delete from public.questions`)).rowCount).toBe(0)
    expect((await tx.q(`select * from public.question_revisions`)).rowCount).toBe(0)
  })

  it('admins can write the catalogue and see unpublished questions; students still cannot', async () => {
    await tx.as('authenticated', ADMIN)
    expect((await tx.ok(`select id from public.questions order by id`)).rowCount).toBe(2)
    expect((await tx.q(`insert into public.subjects (id, name) values ('physiology','Physiology')`)).error).toBeUndefined()
    await tx.as('authenticated', A)
    expect((await tx.ok(`select id from public.questions`)).rows).toEqual([{ id: 'demo-anat-001' }])
  })

  it('never allows publishing a question that is still marked unreviewed', async () => {
    for (const role of ['service_role', 'authenticated'] as const) {
      await tx.as(role, role === 'authenticated' ? ADMIN : undefined)
      const r = await tx.q(`update public.questions set status = 'published' where id = 'demo-anat-002'`)
      expect(r.error?.code).toBe(PG_CHECK)
    }
  })

  it('rejects malformed catalogue rows', async () => {
    await tx.as('service_role')
    expect((await tx.q(`insert into public.questions (id,subject_id,topic_id,difficulty,format) values ('q-1','anatomy','heart','extreme','sba')`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.questions (id,status,subject_id,topic_id,difficulty,format) values ('q-2','live','anatomy','heart','easy','sba')`)).error?.code).toBe(PG_CHECK)
    expect((await tx.q(`insert into public.questions (id,subject_id,topic_id,difficulty,format) values ('q-3','anatomy','missing-topic','easy','sba')`)).error?.code).toBe(PG_FK)
    expect((await tx.q(`insert into public.topics (id,subject_id,parent_id,name) values ('loop','anatomy','loop','Loop')`)).error?.code).toBe(PG_CHECK) // own parent
    expect((await tx.q(`insert into public.topics (id,subject_id,parent_id,name) values ('orphan','anatomy','nope','Orphan')`)).error?.code).toBe(PG_FK)
    expect((await tx.q(`insert into public.subjects (id,name) values ('Bad Id!','x')`)).error?.code).toBe(PG_CHECK)
  })

  it('user data refers to question ids only: works with no matching question row, and survives question deletion', async () => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.attempts (question_id, selected_option, is_correct) values ('not-in-database','A',true)`)
    await tx.ok(`insert into public.attempts (question_id, selected_option, is_correct) values ('demo-anat-001','A',true)`)
    await tx.as('service_role')
    await tx.ok(`delete from public.questions where id = 'demo-anat-001'`)
    await tx.as('authenticated', A)
    const left = await tx.q(`select count(*)::int as n from public.attempts`)
    expect((left.rows ?? left.data)?.[0]?.n).toBe(2)
  })

  it('still protects the taxonomy that questions use from being deleted', async () => {
    await tx.as('service_role')
    expect((await tx.q(`delete from public.subjects where id = 'anatomy'`)).error?.code).toBe(PG_FK)
  })
})

describe('backup_runs cannot be faked', () => {
  it('is invisible to students and unwritable by users', async () => {
    await tx.as('service_role')
    await tx.ok(`insert into public.backup_runs (status, finished_at, destination, size_bytes, sha256)
                 values ('success', now(), 'github-artifact', 1234, repeat('a',64))`)
    await tx.as('authenticated', A)
    expect((await tx.ok(`select * from public.backup_runs`)).rowCount).toBe(0)
    expect((await tx.q(`insert into public.backup_runs (status) values ('running')`)).error?.code).toBe(PG_RLS_VIOLATION)
    expect((await tx.q(`update public.backup_runs set status = 'failed'`)).error?.code).toBe(PG_RLS_VIOLATION)
    await tx.as('authenticated', ADMIN)
    expect((await tx.ok(`select * from public.backup_runs`)).rowCount).toBe(1)
    expect((await tx.q(`insert into public.backup_runs (status) values ('running')`)).error?.code).toBe(PG_RLS_VIOLATION)
  })

  it('rejects a success row without evidence, even from the service role', async () => {
    await tx.as('service_role')
    const ins = (cols: string, vals: string) => tx.q(`insert into public.backup_runs (${cols}) values (${vals})`)
    expect((await ins('status', `'success'`)).error?.code).toBe(PG_CHECK)
    expect((await ins('status, finished_at', `'success', now()`)).error?.code).toBe(PG_CHECK)
    expect((await ins('status, finished_at, destination, size_bytes, sha256', `'success', now(), 'x', 10, 'not-a-hash'`)).error?.code).toBe(PG_CHECK)
    expect((await ins('status, finished_at, destination, size_bytes, sha256', `'success', now(), 'x', 0, repeat('a',64)`)).error?.code).toBe(PG_CHECK)
    expect((await ins('status', `'failed'`)).error?.code).toBe(PG_CHECK) // finished_at required
    expect((await ins('status, finished_at, error_message', `'failed', now(), 'boom'`)).error).toBeUndefined()
  })
})

describe('account deletion', () => {
  it('removes the caller and all their data, and nobody else', async () => {
    for (const s of USER_TABLES) {
      await tx.as('authenticated', A)
      expect((await insertAs(s, A)).error).toBeUndefined()
      await tx.as('authenticated', B)
      expect((await insertAs(s, B)).error).toBeUndefined()
    }
    await tx.as('authenticated', A)
    expect((await tx.q(`select public.delete_my_account()`)).error).toBeUndefined()

    await tx.as('postgres')
    expect((await tx.ok(`select 1 from auth.users where id = $1`, [A])).rowCount).toBe(0)
    expect((await tx.ok(`select 1 from public.profiles where id = $1`, [A])).rowCount).toBe(0)
    expect((await tx.ok(`select 1 from public.user_preferences where user_id = $1`, [A])).rowCount).toBe(0)
    for (const s of USER_TABLES) {
      const a = await tx.ok(`select 1 from public.${s.table} where user_id = $1`, [A])
      const b = await tx.ok(`select 1 from public.${s.table} where user_id = $1`, [B])
      expect(a.rowCount, `${s.table} rows of deleted user`).toBe(0)
      expect(b.rowCount, `${s.table} rows of other user`).toBe(1)
    }
    expect((await tx.ok(`select 1 from auth.users where id = $1`, [B])).rowCount).toBe(1)
  })

  it('refuses when there is no signed-in user', async () => {
    await tx.as('authenticated') // role without a sub claim
    const r = await tx.q(`select public.delete_my_account()`)
    expect(r.error?.code).toBe('28000')
  })
})

describe('structural guards (fail if a future migration forgets security)', () => {
  it('every table in public has row level security enabled', async () => {
    await tx.as('postgres')
    const r = await tx.ok(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    )
    expect(r.rows).toEqual([])
  })

  it('anon holds no privileges on any private table', async () => {
    await tx.as('postgres')
    const r = await tx.ok(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'
         and table_name not in ('subjects','topics','questions')`,
    )
    expect(r.rows).toEqual([])
  })

  it('every public function pins search_path (no search_path hijacking)', async () => {
    await tx.as('postgres')
    const r = await tx.ok(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    )
    expect(r.rows).toEqual([])
  })

  it('every user-owned table has a user_id foreign key that cascades on account deletion', async () => {
    await tx.as('postgres')
    const r = await tx.ok(
      `select cl.relname
       from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'public' and cl.relkind = 'r'
         and cl.relname = any($1)
         and not exists (
           select 1 from pg_constraint k
           where k.conrelid = cl.oid and k.contype = 'f' and k.confrelid = 'auth.users'::regclass
             and k.confdeltype = 'c')`,
      [USER_TABLES.map((s) => s.table)],
    )
    expect(r.rows).toEqual([])
  })
})
