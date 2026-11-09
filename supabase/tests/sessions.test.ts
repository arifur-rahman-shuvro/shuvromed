import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Tx } from './support/db'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CHECK = '23514'
const FK = '23503'
const UNIQUE = '23505'
const DENIED = '42501'
const SBA = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }

let tx: Tx
beforeAll(async () => { tx = await Tx.open() })
afterAll(async () => { await tx.close() })
beforeEach(async () => {
  await tx.begin()
  await tx.as('postgres')
  await tx.ok(`insert into auth.users (id, email) values ($1,'a@t.local'), ($2,'b@t.local')`, [A, B])
})
afterEach(async () => { await tx.rollback() })

async function question(uid: string): Promise<string> {
  await tx.as('authenticated', uid)
  const s = (await tx.ok(`insert into public.user_subjects (name) values ('Anatomy') returning id`)).rows[0].id
  return (await tx.ok(`insert into public.user_questions (subject_id, question_type, stem, content) values ($1,'SBA','Q?',$2) returning id`, [s, JSON.stringify(SBA)])).rows[0].id
}
const session = (over: Record<string, unknown> = {}, qids: string[] = ['00000000-0000-4000-8000-000000000001']) => {
  const f = { kind: 'practice', title: 'Practice', config: {}, question_ids: JSON.stringify(qids), started_at: '2026-11-09T01:00:00Z', ...over }
  const cols = Object.keys(f)
  return tx.q(`insert into public.user_sessions (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(f).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)))
}
const finished = { status: 'finished', finished_at: '2026-11-09T01:30:00Z', score: 4, max_score: 5, correct: 4, incorrect: 1, partial: 0, unanswered: 0 }

describe('saved exams', () => {
  it('own rows only; names unique ignoring case; config must be an object', async () => {
    await tx.as('authenticated', A)
    const add = (name: string, cfg: unknown = { count: 20 }) => tx.q(`insert into public.user_exams (name, config) values ($1,$2)`, [name, JSON.stringify(cfg)])
    expect((await add('Mock 1')).error).toBeUndefined()
    expect((await add('mock  1')).error?.code).toBe(UNIQUE)
    expect((await add('x', [1])).error?.code).toBe(CHECK)
    expect((await add('  ')).error?.code).toBe(CHECK)
    expect((await add('big', { x: 'y'.repeat(20001) })).error?.code).toBe(CHECK)
    await tx.as('authenticated', B)
    expect((await tx.ok(`select count(*)::int n from public.user_exams`)).rows[0].n).toBe(0)
    expect((await add('Mock 1')).error).toBeUndefined()
  })
  it('can be deleted, and the sessions run from it are kept', async () => {
    await tx.as('authenticated', A)
    const exam = (await tx.ok(`insert into public.user_exams (name, config) values ('E','{}') returning id`)).rows[0].id
    const sid = (await session({ kind: 'exam', exam_id: exam })).rows?.[0].id
    await tx.ok(`delete from public.user_exams where id=$1`, [exam])
    const row = (await tx.ok(`select exam_id from public.user_sessions where id=$1`, [sid])).rows[0]
    expect(row.exam_id).toBeNull()
  })
  it('a session cannot point at another person\'s exam', async () => {
    await tx.as('authenticated', B)
    const exam = (await tx.ok(`insert into public.user_exams (name, config) values ('B exam','{}') returning id`)).rows[0].id
    await tx.as('authenticated', A)
    expect((await session({ kind: 'exam', exam_id: exam })).error?.code).toBe(FK)
  })
})

describe('sessions', () => {
  it('saves a running session for its owner with defaults', async () => {
    await tx.as('authenticated', A)
    const r = await session()
    expect(r.error).toBeUndefined()
    expect((await tx.ok(`select owner_id, status, elapsed_ms, row_version from public.user_sessions`)).rows[0]).toMatchObject({ owner_id: A, status: 'in_progress', elapsed_ms: 0, row_version: 1 })
  })
  it('checks kind, status, title, the question list, state and the time limit', async () => {
    await tx.as('authenticated', A)
    expect((await session({ kind: 'quiz' })).error?.code).toBe(CHECK)
    expect((await session({ status: 'paused' })).error?.code).toBe(CHECK)
    expect((await session({ title: '  ' })).error?.code).toBe(CHECK)
    expect((await session({}, [])).error?.code).toBe(CHECK)
    expect((await session({}, Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))).error?.code).toBe(CHECK)
    expect((await session({ question_ids: '"x"' })).error?.code).toBe(CHECK)
    expect((await session({ state: [] })).error?.code).toBe(CHECK)
    expect((await session({ time_limit_seconds: 10 })).error?.code).toBe(CHECK)
    expect((await session({ time_limit_seconds: 3600 })).error).toBeUndefined()
  })
  it('500 questions are allowed', async () => {
    await tx.as('authenticated', A)
    expect((await session({}, Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))).error).toBeUndefined()
  })
  it('finished needs a result; a running one does not', async () => {
    await tx.as('authenticated', A)
    expect((await session({ status: 'finished' })).error?.code).toBe(CHECK)
    expect((await session({ ...finished })).error).toBeUndefined()
  })
  it('each person sees only their own sessions and cannot write for someone else', async () => {
    await tx.as('authenticated', A); await session()
    await tx.as('authenticated', B)
    expect((await tx.ok(`select count(*)::int n from public.user_sessions`)).rows[0].n).toBe(0)
    expect((await tx.ok(`update public.user_sessions set title='x'`)).rowCount).toBe(0)
    expect((await tx.q(`insert into public.user_sessions (owner_id, kind, title, config, question_ids, started_at) values ($1,'practice','t','{}','["00000000-0000-4000-8000-000000000001"]','2026-11-09')`, [A])).error?.code).toBe(DENIED)
  })
  it('nobody can delete a session through the API, and signed-out visitors have no access', async () => {
    await tx.as('authenticated', A); await session()
    expect((await tx.q(`delete from public.user_sessions`)).error?.code).toBe(DENIED)
    await tx.as('anon')
    expect((await tx.q(`select * from public.user_sessions`)).error?.code).toBe(DENIED)
    expect((await tx.q(`select * from public.user_exams`)).error?.code).toBe(DENIED)
  })
  it('a running session can be updated and bumps row_version', async () => {
    await tx.as('authenticated', A); await session()
    await tx.ok(`update public.user_sessions set state='{"index":3}', elapsed_ms=5000`)
    expect((await tx.ok(`select row_version, elapsed_ms from public.user_sessions`)).rows[0]).toMatchObject({ row_version: 2, elapsed_ms: 5000 })
  })
  it('a finished session is a record: result, questions and settings cannot change; title, hidden flag and view state can', async () => {
    await tx.as('authenticated', A); await session({ ...finished, elapsed_ms: 1000 })
    for (const sql of [
      `status='in_progress'`, `score=5`, `correct=5`, `elapsed_ms=2000`, `finished_at='2026-11-10T00:00:00Z'`,
      `question_ids='["00000000-0000-4000-8000-000000000002"]'`, `config='{"a":1}'`, `kind='exam'`, `started_at='2026-11-01T00:00:00Z'`,
    ]) expect((await tx.q(`update public.user_sessions set ${sql}`)).error?.code, sql).toBe(CHECK)
    expect((await tx.q(`update public.user_sessions set title='Renamed', hidden_at=now(), state='{"view":1}'`)).error).toBeUndefined()
  })
  it('an old copy of a running session cannot reopen a finished one', async () => {
    await tx.as('authenticated', A); await session({ ...finished })
    expect((await tx.q(`update public.user_sessions set status='in_progress', finished_at=null`)).error?.code).toBe(CHECK)
  })
})

describe('attempts and sessions', () => {
  it('an attempt can reference its session; an unknown or foreign session is refused', async () => {
    const q = await question(A)
    const sid = (await session({}, [q])).rows![0].id
    const attempt = (sess: string | null) => tx.q(
      `insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, attempted_at, session_id, mode) values (gen_random_uuid(), $1, 1, '{"selected":"a"}', 1, 1, 'correct', now(), $2, 'practice')`, [q, sess])
    expect((await attempt(sid)).error).toBeUndefined()
    expect((await attempt(null)).error).toBeUndefined()
    expect((await attempt('00000000-0000-4000-8000-0000000000ff')).error?.code).toBe(FK)
    await tx.as('authenticated', B)
    const bq = await question(B)
    expect((await tx.q(`insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, attempted_at, session_id) values (gen_random_uuid(), $1, 1, '{}', 0, 1, 'unanswered', now(), $2)`, [bq, sid])).error?.code).toBe(FK)
  })
  it('the rollback file removes only M8 and leaves attempts working', async () => {
    const q = await question(A)
    const sid = (await session({}, [q])).rows![0].id
    await tx.ok(`insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, attempted_at, session_id) values (gen_random_uuid(), $1, 1, '{}', 0, 1, 'unanswered', now(), $2)`, [q, sid])
    await tx.as('postgres')
    const sql = readFileSync(join(__dirname, '..', 'rollback', '20261109100000_exams_and_sessions.down.sql'), 'utf8').replace(/^begin;|commit;$/gm, '')
    await tx.ok(sql)
    expect((await tx.ok(`select count(*)::int n from pg_tables where schemaname='public' and tablename in ('user_exams','user_sessions')`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from pg_constraint where conname='user_question_attempts_session_fk'`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from public.user_question_attempts`)).rows[0].n).toBe(1)
  })
})
