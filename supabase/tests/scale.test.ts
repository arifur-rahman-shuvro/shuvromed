import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Tx } from './support/db'

/**
 * Phase 11: a user with 20,000 questions, 40,000 tag links, 20,000 topic links and 20,000 saved answers.
 * The queries that sync runs must stay fast, row-level security must not slow them badly, and deleting the account must finish.
 */
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const SBA = JSON.stringify({ options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' })
const N = 20000
let tx: Tx
const T: Record<string, number> = {}
const timed = async <R,>(k: string, f: () => Promise<R>): Promise<R> => { const t0 = performance.now(); const r = await f(); T[k] = Math.round(performance.now() - t0); return r }

beforeAll(async () => {
  tx = await Tx.open()
  await tx.begin()
  await tx.as('postgres')
  await tx.ok(`insert into auth.users (id, email) values ($1,'a@t.local'), ($2,'b@t.local')`, [A, B])
  await tx.as('authenticated', A)
  const s = (await tx.ok(`insert into public.user_subjects (name) values ('Anatomy') returning id`)).rows[0].id
  const topic = (await tx.ok(`insert into public.user_topics (subject_id, name) values ($1,'Heart') returning id`, [s])).rows[0].id
  const tags = (await tx.ok(`insert into public.user_tags (category, name) select 'general', 'tag' || g from generate_series(1, 6) g returning id`)).rows.map((r) => r.id as string)
  await timed('insert 20,000 questions (RLS on)', () => tx.ok(`insert into public.user_questions (id, subject_id, question_type, stem, content) select gen_random_uuid(), $1, 'SBA', 'Statement ' || g, $2::jsonb from generate_series(1, ${N}) g`, [s, SBA]))
  await timed('insert 20,000 topic links', () => tx.ok(`insert into public.user_question_topics (question_id, topic_id) select id, $1 from public.user_questions`, [topic]))
  await timed('insert 40,000 tag links', () => tx.ok(`insert into public.user_question_tag_links (question_id, tag_id) select q.id, t from public.user_questions q cross join lateral unnest($1::uuid[]) with ordinality u(t, n) where u.n <= 2`, [tags]))
  await timed('insert 20,000 answers', () => tx.ok(`insert into public.user_question_attempts (id, question_id, question_version, response, score, max_score, outcome, mode, attempted_at)
    select gen_random_uuid(), id, 1, '{}'::jsonb, 1, 1, 'correct', 'practice', now() - (random() * interval '90 days') from public.user_questions`))
  // a second user with a little data, to be sure A's volume does not leak into B's reads
  await tx.as('authenticated', B)
  const sb = (await tx.ok(`insert into public.user_subjects (name) values ('Mine') returning id`)).rows[0].id
  await tx.ok(`insert into public.user_questions (id, subject_id, question_type, stem, content) values (gen_random_uuid(), $1, 'SBA', 'B question', $2::jsonb)`, [sb, SBA])
}, 300000)
afterAll(async () => { await tx.rollback(); await tx.close(); console.log('\nDATABASE SCALE (ms)\n' + Object.entries(T).map(([k, v]) => `${String(v).padStart(8)}  ${k}`).join('\n')) })

describe('one user with 20,000 questions', () => {
  it('reads a page of 1,000 questions in sync order quickly, and the last page too', async () => {
    await tx.as('authenticated', A)
    const first = await timed('sync page 1 (1,000 by updated_at)', () => tx.ok(`select * from public.user_questions order by updated_at, id limit 1000`))
    expect(first.rows).toHaveLength(1000)
    const since = first.rows[999].updated_at
    const last = await timed('sync page after a cursor', () => tx.ok(`select * from public.user_questions where updated_at >= $1 order by updated_at, id limit 1000 offset 18000`, [since]))
    expect(last.rows.length).toBeGreaterThan(0)
    expect(T['sync page 1 (1,000 by updated_at)']).toBeLessThan(2000)
  })
  it('reads the links of 80 questions (one sync request) quickly', async () => {
    await tx.as('authenticated', A)
    const ids = (await tx.ok(`select id from public.user_questions limit 80`)).rows.map((r) => r.id)
    const tagLinks = await timed('links of 80 questions: tags', () => tx.ok(`select * from public.user_question_tag_links where question_id = any($1::uuid[])`, [ids]))
    const topicLinks = await timed('links of 80 questions: topics', () => tx.ok(`select * from public.user_question_topics where question_id = any($1::uuid[])`, [ids]))
    expect(tagLinks.rows).toHaveLength(160)
    expect(topicLinks.rows).toHaveLength(80)
    expect(T['links of 80 questions: tags']).toBeLessThan(1000)
  })
  it('reads pages of answers by creation time quickly', async () => {
    await tx.as('authenticated', A)
    const r = await timed('answers page (1,000 by created_at)', () => tx.ok(`select * from public.user_question_attempts order by created_at, id limit 1000`))
    expect(r.rows).toHaveLength(1000)
    expect(T['answers page (1,000 by created_at)']).toBeLessThan(2000)
  })
  it('another user sees only their own rows and is not slowed by the big user', async () => {
    await tx.as('authenticated', B)
    const r = await timed('other user reads their questions', () => tx.ok(`select * from public.user_questions order by updated_at limit 1000`))
    expect(r.rows).toHaveLength(1)
    expect((await tx.ok(`select count(*)::int c from public.user_question_attempts`)).rows[0].c).toBe(0)
    expect(T['other user reads their questions']).toBeLessThan(500)
  })
  it('deleting the account removes everything and finishes in reasonable time', async () => {
    await tx.as('postgres')
    await timed('delete the whole account (cascade)', () => tx.ok(`delete from auth.users where id = $1`, [A]))
    for (const t of ['user_questions', 'user_question_topics', 'user_question_tag_links', 'user_question_attempts', 'user_question_versions', 'user_subjects', 'user_topics', 'user_tags']) {
      expect((await tx.ok(`select count(*)::int c from public.${t} where owner_id = $1`, [A])).rows[0].c, t).toBe(0)
    }
    expect((await tx.ok(`select count(*)::int c from public.user_questions where owner_id = $1`, [B])).rows[0].c).toBe(1)
    expect(T['delete the whole account (cascade)']).toBeLessThan(120000)
  })
})
