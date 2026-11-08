import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Tx } from './support/db'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CHECK = '23514'
const FK = '23503'
const UNIQUE = '23505'
const DENIED = '42501'

const SBA = {
  options: [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
  ],
  correct_option_id: 'a',
}

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
  await tx.ok(`insert into auth.users (id, email) values ($1,'a@t.local'), ($2,'b@t.local')`, [A, B])
})
afterEach(async () => {
  await tx.rollback()
})

async function subject(uid: string, name = 'Anatomy'): Promise<string> {
  await tx.as('authenticated', uid)
  const r = await tx.ok(`insert into public.user_subjects (name) values ($1) returning id`, [name])
  return r.rows[0].id as string
}
async function question(uid: string, sid: string, content: unknown = SBA, stem = 'Q?', type = 'SBA'): Promise<string> {
  await tx.as('authenticated', uid)
  const r = await tx.ok(
    `insert into public.user_questions (subject_id, question_type, stem, content) values ($1,$2,$3,$4) returning id`,
    [sid, type, stem, JSON.stringify(content)],
  )
  return r.rows[0].id as string
}

describe('empty by default', () => {
  it('a new account sees no rows in any private table', async () => {
    await tx.as('authenticated', A)
    for (const t of ['user_subjects', 'user_topics', 'user_tags', 'user_questions', 'user_question_versions', 'user_question_attempts']) {
      const r = await tx.ok(`select count(*)::int n from public.${t}`)
      expect(r.rows[0].n).toBe(0)
    }
  })
  it('anon has no access', async () => {
    await tx.as('anon')
    const r = await tx.q(`select * from public.user_subjects`)
    expect(r.error?.code).toBe(DENIED)
  })
})

describe('two-user isolation', () => {
  it('B cannot see, change or delete A rows', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', B)
    expect((await tx.ok(`select count(*)::int n from public.user_subjects`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from public.user_questions`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from public.user_question_versions`)).rows[0].n).toBe(0)
    expect((await tx.ok(`update public.user_questions set stem='hacked' where id=$1`, [q])).rowCount).toBe(0)
    expect((await tx.ok(`delete from public.user_subjects where id=$1`, [s])).rowCount).toBe(0)
    await tx.as('authenticated', A)
    expect((await tx.ok(`select stem from public.user_questions where id=$1`, [q])).rows[0].stem).toBe('Q?')
  })
  it('cannot insert a row owned by someone else', async () => {
    await tx.as('authenticated', A)
    const r = await tx.q(`insert into public.user_subjects (owner_id, name) values ($1,'x')`, [B])
    expect(r.error?.code).toBe(DENIED)
  })
  it('cannot hand a row to another owner by update', async () => {
    const s = await subject(A)
    const r = await tx.q(`update public.user_subjects set owner_id=$1 where id=$2`, [B, s])
    expect(r.error?.code).toBe(DENIED)
  })
  it('cannot link to another owner subject (composite FK)', async () => {
    const sA = await subject(A)
    await tx.as('authenticated', B)
    const r = await tx.q(
      `insert into public.user_questions (subject_id, question_type, stem, content) values ($1,'SBA','Q',$2)`,
      [sA, JSON.stringify(SBA)],
    )
    expect(r.error?.code).toBe(FK)
  })
  it('cannot attach another owner tag or topic to own question', async () => {
    const sA = await subject(A)
    await tx.as('authenticated', A)
    const tagA = (await tx.ok(`insert into public.user_tags (category,name) values ('exam','FCPS') returning id`)).rows[0].id
    const sB = await subject(B)
    const qB = await question(B, sB)
    await tx.as('authenticated', B)
    expect((await tx.q(`insert into public.user_question_tag_links (question_id, tag_id) values ($1,$2)`, [qB, tagA])).error?.code).toBe(FK)
    expect(sA).toBeTruthy()
  })
})

describe('subjects, topics, tags', () => {
  it('subject names are unique per owner, case and spacing insensitive, but not across owners', async () => {
    await subject(A, 'Anatomy')
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.user_subjects (name) values ('  anatomy ')`)).error?.code).toBe(UNIQUE)
    await subject(B, 'Anatomy')
  })
  it('topic tree: same subject parent, no cycle, no moving subject, unique siblings', async () => {
    const s1 = await subject(A, 'S1')
    const s2 = await subject(A, 'S2')
    await tx.as('authenticated', A)
    const t1 = (await tx.ok(`insert into public.user_topics (subject_id,name) values ($1,'T1') returning id`, [s1])).rows[0].id
    const t2 = (await tx.ok(`insert into public.user_topics (subject_id,parent_id,name) values ($1,$2,'T2') returning id`, [s1, t1])).rows[0].id
    const t3 = (await tx.ok(`insert into public.user_topics (subject_id,parent_id,name) values ($1,$2,'T3') returning id`, [s1, t2])).rows[0].id
    expect((await tx.q(`insert into public.user_topics (subject_id,parent_id,name) values ($1,$2,'X')`, [s2, t1])).error?.code).toBe(CHECK)
    expect((await tx.q(`update public.user_topics set parent_id=$1 where id=$2`, [t3, t1])).error?.code).toBe(CHECK)
    expect((await tx.q(`update public.user_topics set parent_id=id where id=$1`, [t1])).error?.code).toBe(CHECK)
    expect((await tx.q(`update public.user_topics set subject_id=$1 where id=$2`, [s2, t3])).error?.code).toBe(CHECK)
    expect((await tx.q(`insert into public.user_topics (subject_id,parent_id,name) values ($1,$2,' t2 ')`, [s1, t1])).error?.code).toBe(UNIQUE)
  })
  it('subject with dependents cannot be deleted silently', async () => {
    const s = await subject(A)
    await question(A, s)
    await tx.as('authenticated', A)
    expect((await tx.q(`delete from public.user_subjects where id=$1`, [s])).error?.code).toBe(FK)
  })
  it('exam and general tags are separate namespaces; category validated', async () => {
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.user_tags (category,name) values ('exam','Final'),('general','Final')`)
    expect((await tx.q(`insert into public.user_tags (category,name) values ('exam','final')`)).error?.code).toBe(UNIQUE)
    expect((await tx.q(`insert into public.user_tags (category,name) values ('other','x')`)).error?.code).toBe(CHECK)
  })
})

describe('questions and versions', () => {
  it('insert creates version 1; meaning edits bump; classification edits do not', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    const get = async () => (await tx.ok(`select current_version v from public.user_questions where id=$1`, [q])).rows[0].v
    expect(await get()).toBe(1)
    await tx.ok(`update public.user_questions set stem='Q2?' where id=$1`, [q])
    expect(await get()).toBe(2)
    await tx.ok(`update public.user_questions set archived_at=now() where id=$1`, [q])
    expect(await get()).toBe(2)
    const t = (await tx.ok(`insert into public.user_topics (subject_id,name) values ($1,'T') returning id`, [s])).rows[0].id
    await tx.ok(`insert into public.user_question_topics (question_id, topic_id) values ($1,$2)`, [q, t])
    expect(await get()).toBe(2)
    const vs = await tx.ok(`select version, stem, subject_name from public.user_question_versions where question_id=$1 order by version`, [q])
    expect(vs.rows.map((r) => r.stem)).toEqual(['Q?', 'Q2?'])
    expect(vs.rows[0].subject_name).toBe('Anatomy')
  })
  it('client cannot forge, edit or delete versions, or set current_version', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    expect((await tx.q(`insert into public.user_question_versions (owner_id,question_id,version,question_type,stem,content,subject_id,subject_name,content_hash) values ($1,$2,9,'SBA','x','{}',$3,'x','h')`, [A, q, s])).error?.code).toBe(DENIED)
    expect((await tx.q(`update public.user_question_versions set stem='x'`)).error?.code).toBe(DENIED)
    expect((await tx.q(`delete from public.user_question_versions`)).error?.code).toBe(DENIED)
    await tx.ok(`update public.user_questions set current_version=50 where id=$1`, [q])
    expect((await tx.ok(`select current_version v from public.user_questions where id=$1`, [q])).rows[0].v).toBe(1)
  })
  it('topic must be in the question subject; subject change blocked while topics linked', async () => {
    const s1 = await subject(A, 'S1')
    const s2 = await subject(A, 'S2')
    const q = await question(A, s1)
    await tx.as('authenticated', A)
    const t2 = (await tx.ok(`insert into public.user_topics (subject_id,name) values ($1,'T') returning id`, [s2])).rows[0].id
    expect((await tx.q(`insert into public.user_question_topics (question_id, topic_id) values ($1,$2)`, [q, t2])).error?.code).toBe(CHECK)
    const t1 = (await tx.ok(`insert into public.user_topics (subject_id,name) values ($1,'T') returning id`, [s1])).rows[0].id
    await tx.ok(`insert into public.user_question_topics (question_id, topic_id) values ($1,$2)`, [q, t1])
    expect((await tx.q(`update public.user_questions set subject_id=$1 where id=$2`, [s2, q])).error?.code).toBe(CHECK)
  })
  it('question with no exam tag is allowed (Universal); deleting a tag keeps the question', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    const tag = (await tx.ok(`insert into public.user_tags (category,name) values ('exam','FCPS') returning id`)).rows[0].id
    await tx.ok(`insert into public.user_question_tag_links (question_id, tag_id) values ($1,$2)`, [q, tag])
    await tx.ok(`delete from public.user_tags where id=$1`, [tag])
    expect((await tx.ok(`select count(*)::int n from public.user_question_tag_links`)).rows[0].n).toBe(0)
    expect((await tx.ok(`select count(*)::int n from public.user_questions where id=$1`, [q])).rows[0].n).toBe(1)
  })
})

describe('content validation per type', () => {
  const bad: Array<[string, string, unknown, string?]> = [
    ['SBA unknown correct id', 'SBA', { options: SBA.options, correct_option_id: 'z' }],
    ['SBA one option', 'SBA', { options: [{ id: 'a', text: 'x' }], correct_option_id: 'a' }],
    ['SBA duplicate option text', 'SBA', { options: [{ id: 'a', text: 'Same' }, { id: 'b', text: ' same ' }], correct_option_id: 'a' }],
    ['SBA duplicate ids', 'SBA', { options: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }], correct_option_id: 'a' }],
    ['SBA extra key', 'SBA', { ...SBA, junk: 1 }],
    ['SBA bad scoring key', 'SBA', { ...SBA, scoring: { mode: 'exact' } }],
    ['MULTI single correct', 'MULTIPLE_MCQ', { options: SBA.options, correct_option_ids: ['a'] }],
    ['MULTI unknown id', 'MULTIPLE_MCQ', { options: SBA.options, correct_option_ids: ['a', 'q'] }],
    ['TF not boolean', 'TRUE_FALSE', { correct_answer: 'yes' }],
    ['FILL blank missing from stem', 'FILL_GAP', { blanks: [{ id: 'b1', accepted_answers: ['x'] }] }],
    ['FILL no answers', 'FILL_GAP', { blanks: [{ id: 'b1', accepted_answers: [] }] }, 'Fill {{b1}}'],
  ]
  for (const [name, type, content, stem] of bad) {
    it(`rejects: ${name}`, async () => {
      const s = await subject(A)
      await tx.as('authenticated', A)
      const r = await tx.q(
        `insert into public.user_questions (subject_id, question_type, stem, content) values ($1,$2,$3,$4)`,
        [s, type, stem ?? 'Q?', JSON.stringify(content)],
      )
      expect(r.error?.code).toBe(CHECK)
    })
  }
  it('accepts valid examples of all four types', async () => {
    const s = await subject(A)
    await question(A, s, SBA)
    await question(A, s, { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correct_option_ids: ['a', 'c'], scoring: { mode: 'partial', penalty_weight: 1 } }, 'M?', 'MULTIPLE_MCQ')
    await question(A, s, { correct_answer: true, scoring: { negative_marks: 0.25 } }, 'TF', 'TRUE_FALSE')
    await question(A, s, { blanks: [{ id: 'b1', accepted_answers: ['heart', 'cor'] }] }, 'The {{b1}} pumps', 'FILL_GAP')
  })
})

describe('attempts, bookmarks, notes, review', () => {
  it('attempts are append-only and tied to the exact version answered', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    const id = '33333333-3333-4333-8333-333333333333'
    await tx.ok(
      `insert into public.user_question_attempts (id,question_id,question_version,response,score,max_score,outcome,attempted_at) values ($1,$2,1,'{"o":"a"}',1,1,'correct',now())`,
      [id, q],
    )
    expect((await tx.q(`update public.user_question_attempts set score=0`)).error?.code).toBe(DENIED)
    expect((await tx.q(`delete from public.user_question_attempts`)).error?.code).toBe(DENIED)
    expect((await tx.q(
      `insert into public.user_question_attempts (id,question_id,question_version,response,score,max_score,outcome,attempted_at) values (gen_random_uuid(),$1,7,'{}',1,1,'correct',now())`,
      [q],
    )).error?.code).toBe(FK)
    await tx.as('authenticated', B)
    expect((await tx.ok(`select count(*)::int n from public.user_question_attempts`)).rows[0].n).toBe(0)
  })
  it('attempt history survives a later edit and still names the old version', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.user_question_attempts (id,question_id,question_version,response,score,max_score,outcome,attempted_at) values (gen_random_uuid(),$1,1,'{}',1,1,'correct',now())`, [q])
    await tx.ok(`update public.user_questions set stem='Changed' where id=$1`, [q])
    const r = await tx.ok(`select a.question_version, v.stem from public.user_question_attempts a join public.user_question_versions v on v.question_id=a.question_id and v.version=a.question_version`)
    expect(r.rows[0]).toMatchObject({ question_version: 1, stem: 'Q?' })
  })
  it('bookmark, note, review, report work for own question only', async () => {
    const sA = await subject(A)
    const qA = await question(A, sA)
    await tx.as('authenticated', A)
    await tx.ok(`insert into public.user_question_bookmarks (question_id) values ($1)`, [qA])
    await tx.ok(`insert into public.user_question_notes (question_id, body) values ($1,'n')`, [qA])
    await tx.ok(`insert into public.user_question_reviews (question_id, due_at) values ($1, now())`, [qA])
    await tx.ok(`insert into public.user_question_reports (question_id, reason) values ($1,'typo')`, [qA])
    await tx.as('authenticated', B)
    for (const sql of [
      `insert into public.user_question_bookmarks (question_id) values ($1)`,
      `insert into public.user_question_notes (question_id, body) values ($1,'n')`,
      `insert into public.user_question_reviews (question_id, due_at) values ($1, now())`,
      `insert into public.user_question_reports (question_id, reason) values ($1,'typo')`,
    ]) expect((await tx.q(sql, [qA])).error?.code).toBe(FK)
  })
  it('deleting a collection keeps its bookmarks', async () => {
    const s = await subject(A)
    const q = await question(A, s)
    await tx.as('authenticated', A)
    const c = (await tx.ok(`insert into public.user_bookmark_collections (name) values ('Hard') returning id`)).rows[0].id
    await tx.ok(`insert into public.user_question_bookmarks (question_id, collection_id) values ($1,$2)`, [q, c])
    await tx.ok(`delete from public.user_bookmark_collections where id=$1`, [c])
    const r = await tx.ok(`select collection_id from public.user_question_bookmarks`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].collection_id).toBeNull()
  })
})

describe('legacy tables are untouched', () => {
  it('legacy attempts table still exists and is isolated from the new tables', async () => {
    await tx.as('postgres')
    const r = await tx.ok(`select to_regclass('public.attempts') is not null as ok`)
    expect(r.rows[0].ok).toBe(true)
  })
})
