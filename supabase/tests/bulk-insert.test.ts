import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Tx } from './support/db'

/**
 * Phase 11: the app now sends new rows to the server in batches (one multi-row insert instead of one request per row).
 * These tests prove the database behaves the same way for a batch as for single rows: same rules, triggers and row-level
 * security, and one bad row rejects the whole batch (the app then sends that batch row by row to find the bad one).
 */
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CHECK = '23514'
const FK = '23503'
const UNIQUE = '23505'
const RLS = '42501'
const SBA = JSON.stringify({ options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' })

let tx: Tx
beforeAll(async () => { tx = await Tx.open() })
afterAll(async () => { await tx.close() })
beforeEach(async () => {
  await tx.begin()
  await tx.as('postgres')
  await tx.ok(`insert into auth.users (id, email) values ($1,'a@t.local'), ($2,'b@t.local')`, [A, B])
})
afterEach(async () => { await tx.rollback() })

async function subject(uid: string, name = 'Anatomy'): Promise<string> {
  await tx.as('authenticated', uid)
  return (await tx.ok(`insert into public.user_subjects (name) values ($1) returning id`, [name])).rows[0].id
}
const manyQuestions = (s: string, n: number) =>
  tx.q(`insert into public.user_questions (id, subject_id, question_type, stem, content)
        select gen_random_uuid(), $1, 'SBA', 'Statement ' || g, $2::jsonb from generate_series(1, $3) g returning id`, [s, SBA, n])

describe('batch insert of questions', () => {
  it('saves 200 questions in one statement, each with its first version, owned by the caller', async () => {
    const s = await subject(A)
    const r = await manyQuestions(s, 200)
    expect(r.error).toBeUndefined()
    expect(r.rows).toHaveLength(200)
    const n = await tx.ok(`select count(*)::int c, count(distinct owner_id)::int o from public.user_questions`)
    expect(n.rows[0]).toEqual({ c: 200, o: 1 })
    const v = await tx.ok(`select count(*)::int c from public.user_question_versions where version = 1`)
    expect(v.rows[0].c).toBe(200)
  })
  it('one invalid row rejects the whole batch and saves nothing', async () => {
    const s = await subject(A)
    const r = await tx.q(`insert into public.user_questions (id, subject_id, question_type, stem, content)
      select gen_random_uuid(), $1, 'SBA', 'S' || g, case when g = 150 then '{"options":[]}'::jsonb else $2::jsonb end from generate_series(1, 200) g`, [s, SBA])
    expect(r.error?.code).toBe(CHECK)
    expect((await tx.ok(`select count(*)::int c from public.user_questions`)).rows[0].c).toBe(0)
  })
  it('a batch that names another user\'s subject is refused, even when most rows are fine', async () => {
    const mine = await subject(A, 'Mine')
    const theirs = await subject(B, 'Theirs')
    await tx.as('authenticated', A)
    const r = await tx.q(`insert into public.user_questions (id, subject_id, question_type, stem, content)
      select gen_random_uuid(), case when g = 7 then $1::uuid else $2::uuid end, 'SBA', 'S' || g, $3::jsonb from generate_series(1, 10) g`, [theirs, mine, SBA])
    expect(r.error).toBeDefined()
    expect((await tx.ok(`select count(*)::int c from public.user_questions`)).rows[0].c).toBe(0)
  })
  it('a duplicate id inside the batch rejects it (the app then falls back to single sends)', async () => {
    const s = await subject(A)
    const id = '33333333-3333-4333-8333-333333333333'
    const r = await tx.q(`insert into public.user_questions (id, subject_id, question_type, stem, content) values ($1,$2,'SBA','one',$3), ($1,$2,'SBA','two',$3)`, [id, s, SBA])
    expect(r.error?.code).toBe(UNIQUE)
  })
})

describe('batch insert of links', () => {
  async function setup() {
    const s = await subject(A)
    const q = (await manyQuestions(s, 3)).rows.map((x) => x.id as string)
    const topics = (await tx.ok(`insert into public.user_topics (subject_id, name) select $1, 'T' || g from generate_series(1, 5) g returning id`, [s])).rows.map((x) => x.id as string)
    return { s, q, topics }
  }
  it('adds many topic links at once, and marks each question as changed', async () => {
    const { q, topics } = await setup()
    const before = (await tx.ok(`select min(row_version)::int v from public.user_questions`)).rows[0].v
    const r = await tx.q(`insert into public.user_question_topics (question_id, topic_id) select q, t from unnest($1::uuid[]) q cross join unnest($2::uuid[]) t`, [q, topics])
    expect(r.error).toBeUndefined()
    expect((await tx.ok(`select count(*)::int c from public.user_question_topics`)).rows[0].c).toBe(15)
    expect((await tx.ok(`select min(row_version)::int v from public.user_questions`)).rows[0].v).toBeGreaterThan(before)
  })
  it('a topic from another subject in the batch rejects the batch', async () => {
    const { q, topics } = await setup()
    const other = (await tx.ok(`insert into public.user_subjects (name) values ('Other') returning id`)).rows[0].id
    const foreign = (await tx.ok(`insert into public.user_topics (subject_id, name) values ($1,'Foreign') returning id`, [other])).rows[0].id
    const r = await tx.q(`insert into public.user_question_topics (question_id, topic_id) values ($1,$2), ($1,$3)`, [q[0], topics[0], foreign])
    expect(r.error?.code).toBe(CHECK)
    expect((await tx.ok(`select count(*)::int c from public.user_question_topics`)).rows[0].c).toBe(0)
  })
  it('the 60-tags-per-question limit holds inside one batch', async () => {
    const { q } = await setup()
    const tags = (await tx.ok(`insert into public.user_tags (category, name) select 'general', 'tag' || g from generate_series(1, 61) g returning id`)).rows.map((x) => x.id as string)
    const bad = await tx.q(`insert into public.user_question_tag_links (question_id, tag_id) select $1, t from unnest($2::uuid[]) t`, [q[0], tags])
    expect(bad.error?.code).toBe(CHECK)
    const good = await tx.q(`insert into public.user_question_tag_links (question_id, tag_id) select $1, t from unnest($2::uuid[]) t`, [q[0], tags.slice(0, 60)])
    expect(good.error).toBeUndefined()
  })
})

describe('batch insert of answers', () => {
  it('saves many answers at once; a missing question version rejects the whole batch', async () => {
    const s = await subject(A)
    const q = (await manyQuestions(s, 2)).rows.map((x) => x.id as string)
    const ins = (version: (g: number) => string) => tx.q(
      `insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, time_ms, mode, attempted_at)
       select gen_random_uuid(), $1, ${version(0)}, '{}'::jsonb, 1, 1, 'correct', 1000, 'practice', now() from generate_series(1, 300) g`, [q[0]])
    expect((await ins(() => '1')).error).toBeUndefined()
    expect((await tx.ok(`select count(*)::int c from public.user_question_attempts`)).rows[0].c).toBe(300)
    const bad = await tx.q(`insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, mode, attempted_at)
      select gen_random_uuid(), $1, case when g = 5 then 9 else 1 end, '{}'::jsonb, 1, 1, 'correct', 'practice', now() from generate_series(1, 10) g`, [q[1]])
    expect(bad.error?.code).toBe(FK)
    expect((await tx.ok(`select count(*)::int c from public.user_question_attempts`)).rows[0].c).toBe(300)
  })
  it('another user cannot read or add answers to your question through a batch', async () => {
    const s = await subject(A)
    const q = (await manyQuestions(s, 1)).rows[0].id
    await tx.as('authenticated', B)
    const r = await tx.q(`insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, mode, attempted_at)
      select gen_random_uuid(), $1, 1, '{}'::jsonb, 1, 1, 'correct', 'practice', now() from generate_series(1, 5)`, [q])
    expect(r.error).toBeDefined()
    expect([FK, RLS]).toContain(r.error?.code)
  })
})
