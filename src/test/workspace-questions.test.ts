import { beforeEach, describe, expect, it } from 'vitest'
import { localQuestionRepo, type QuestionInput, type QuestionRepo } from '../questions/repo'
import type { QuestionContent } from '../questions/schema'
import { localWorkspaceRepo } from '../workspace/localRepo'
import type { WorkspaceRepo } from '../workspace/repo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 8, 13, 0, ++t))
let server: FakeServer
beforeEach(() => { t = 0; server = fakeServer() })

const SBA: QuestionContent = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
const input = (subjectId: string, over: Partial<QuestionInput> = {}): QuestionInput => ({
  subjectId, type: 'SBA', stem: 'Which is first?', difficulty: null, content: SBA, explanation: null, reference: null, topicIds: [], ...over,
})

interface Device { store: WorkspaceStore; ws: WorkspaceRepo; q: QuestionRepo; sync: () => Promise<unknown> }
function device(): Device {
  const store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
  return { store, ws: localWorkspaceRepo(store), q: localQuestionRepo(store), sync: () => runWorkspaceSync(store, server) }
}
const serverRows = (table: string) => [...(server.tables.get(table)?.values() ?? [])]

async function seed(d: Device) {
  const s1 = (await d.ws.createSubject('Anatomy', null)).data!
  const s2 = (await d.ws.createSubject('Physiology', null)).data!
  const t1 = (await d.ws.createTopic(s1.id, null, 'Heart')).data!
  const t2 = (await d.ws.createTopic(s1.id, null, 'Lung')).data!
  const t3 = (await d.ws.createTopic(s2.id, null, 'Renal')).data!
  return { s1, s2, t1, t2, t3 }
}

describe('question repo: rules on the device', () => {
  it('a new account has no questions', async () => {
    expect((await device().q.list()).data).toEqual([])
  })
  it('creates a question with topics and reads it back', async () => {
    const d = device(); const { s1, t1 } = await seed(d)
    const r = await d.q.create(input(s1.id, { topicIds: [t1.id], difficulty: 'hard', explanation: ' why ', reference: '  ' }))
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ subjectId: s1.id, type: 'SBA', topicIds: [t1.id], difficulty: 'hard', explanation: 'why', reference: null, version: null, archived: false, deleted: false })
    expect((await d.q.list()).data).toHaveLength(1)
  })
  it('refuses: no subject, unknown subject, topic of another subject, invalid content, too many topics', async () => {
    const d = device(); const { s1, t3 } = await seed(d)
    expect((await d.q.create(input('nope'))).error).toMatch(/subject/)
    expect((await d.q.create(input(s1.id, { topicIds: [t3.id] }))).error).toMatch(/same subject/)
    expect((await d.q.create(input(s1.id, { content: { options: [{ id: 'a', text: 'x' }], correct_option_id: 'a' } }))).error).toMatch(/at least 2/)
    expect((await d.q.create(input(s1.id, { type: 'TRUE_FALSE', content: SBA }))).error).toBeTruthy()
    expect((await d.q.list()).data).toEqual([])
  })
  it('nothing is half saved when a question is refused', async () => {
    const d = device(); const { s1, t3 } = await seed(d)
    await d.q.create(input(s1.id, { topicIds: [t3.id] }))
    expect(await d.store.list('user_question_topics')).toHaveLength(0)
    expect(await d.store.list('user_questions')).toHaveLength(0)
  })
  it('edit changes topics by adding and removing links', async () => {
    const d = device(); const { s1, t1, t2 } = await seed(d)
    const q = (await d.q.create(input(s1.id, { topicIds: [t1.id] }))).data!
    const r = await d.q.update(q.id, input(s1.id, { topicIds: [t2.id], stem: 'Changed?' }))
    expect(r.data).toMatchObject({ stem: 'Changed?', topicIds: [t2.id] })
  })
  it('archive and delete only flag the question; delete hides it from the list', async () => {
    const d = device(); const { s1 } = await seed(d)
    const q = (await d.q.create(input(s1.id))).data!
    expect((await d.q.setArchived(q.id, true)).data?.archived).toBe(true)
    expect((await d.q.list()).data).toHaveLength(1)
    await d.q.setDeleted(q.id, true)
    expect((await d.q.list()).data).toHaveLength(0)
    expect((await d.q.get(q.id)).data?.deleted).toBe(true)
    await d.q.setDeleted(q.id, false)
    expect((await d.q.list()).data).toHaveLength(1)
  })
  it('warns about a duplicate wording, ignoring case, spacing and blank markers', async () => {
    const d = device(); const { s1 } = await seed(d)
    const a = (await d.q.create(input(s1.id, { stem: 'Which   is FIRST?' }))).data!
    expect((await d.q.findDuplicates('which is first?')).data?.map((x) => x.id)).toEqual([a.id])
    expect((await d.q.findDuplicates('which is first?', a.id)).data).toEqual([])
    expect((await d.q.findDuplicates('something else')).data).toEqual([])
    expect((await d.q.findDuplicates('   ')).data).toEqual([])
  })
  it('keeps and clears an editor draft on the device', async () => {
    const d = device()
    await d.q.saveDraft('new', { stem: 'half written' })
    expect(await d.q.loadDraft('new')).toEqual({ stem: 'half written' })
    await d.q.clearDraft('new')
    expect(await d.q.loadDraft('new')).toBeNull()
  })
  it('a subject or topic with questions cannot be deleted (hidden questions count too)', async () => {
    const d = device(); const { s1, t1 } = await seed(d)
    const q = (await d.q.create(input(s1.id, { topicIds: [t1.id] }))).data!
    expect((await d.ws.subjectUse(s1.id)).data?.questions).toBe(1)
    expect((await d.ws.topicUse(t1.id)).data?.questions).toBe(1)
    await d.q.setDeleted(q.id, true)
    expect((await d.ws.subjectUse(s1.id)).data?.questions).toBe(1)
  })
})

describe('questions and topic links in sync', () => {
  it('sends a question before its links, and the server accepts them', async () => {
    const d = device(); const { s1, t1, t2 } = await seed(d)
    const q = (await d.q.create(input(s1.id, { topicIds: [t1.id, t2.id] }))).data!
    const rep = await d.sync()
    expect(rep).toMatchObject({ rejected: 0, offline: false })
    expect(serverRows('user_questions').map((r) => r.id)).toEqual([q.id])
    expect(serverRows('user_question_topics').map((r) => r.id).sort()).toEqual([`${q.id}:${t1.id}`, `${q.id}:${t2.id}`].sort())
    expect((await d.store.pending()).count).toBe(0)
    expect((await d.q.get(q.id)).data?.version).toBe(1)
  })
  it('a repeated sync changes nothing', async () => {
    const d = device(); const { s1, t1 } = await seed(d)
    await d.q.create(input(s1.id, { topicIds: [t1.id] }))
    await d.sync(); await d.sync()
    const again = await d.sync()
    expect(again).toMatchObject({ pushed: 0, rejected: 0 })
    expect(serverRows('user_questions')).toHaveLength(1)
  })
  it('a meaning change makes a new version; classification-only changes do not', async () => {
    const d = device(); const { s1, t1 } = await seed(d)
    const q = (await d.q.create(input(s1.id))).data!
    await d.sync()
    await d.q.update(q.id, input(s1.id, { topicIds: [t1.id] })) // topics only
    await d.sync()
    expect((await d.q.get(q.id)).data?.version).toBe(1)
    await d.q.update(q.id, input(s1.id, { topicIds: [t1.id], stem: 'New wording?' }))
    await d.sync()
    expect((await d.q.get(q.id)).data?.version).toBe(2)
    await d.q.setArchived(q.id, true)
    await d.sync()
    expect((await d.q.get(q.id)).data?.version).toBe(2)
  })
  it('moving a question to another subject works: old topic links are removed first', async () => {
    const d = device(); const { s1, s2, t1, t3 } = await seed(d)
    const q = (await d.q.create(input(s1.id, { topicIds: [t1.id] }))).data!
    await d.sync()
    await d.q.update(q.id, input(s2.id, { topicIds: [t3.id] }))
    const rep = await d.sync()
    expect(rep).toMatchObject({ rejected: 0 })
    expect(serverRows('user_questions')[0].subject_id).toBe(s2.id)
    expect(serverRows('user_question_topics').map((r) => r.topic_id)).toEqual([t3.id])
  })
  it('a second device receives the question and its topics', async () => {
    const a = device(); const b = device()
    const { s1, t1 } = await seed(a)
    const q = (await a.q.create(input(s1.id, { topicIds: [t1.id], stem: 'From A?' }))).data!
    await a.sync(); await b.sync()
    expect((await b.q.list()).data).toMatchObject([{ id: q.id, stem: 'From A?', topicIds: [t1.id] }])
  })
  it('a topic changed on one device reaches the other', async () => {
    const a = device(); const b = device()
    const { s1, t1, t2 } = await seed(a)
    const q = (await a.q.create(input(s1.id, { topicIds: [t1.id] }))).data!
    await a.sync(); await b.sync()
    await a.q.update(q.id, input(s1.id, { topicIds: [t2.id] }))
    await a.sync(); await b.sync()
    expect((await b.q.get(q.id)).data?.topicIds).toEqual([t2.id])
  })
  it('a deletion on one device hides the question on the other', async () => {
    const a = device(); const b = device()
    const { s1 } = await seed(a)
    const q = (await a.q.create(input(s1.id))).data!
    await a.sync(); await b.sync()
    await a.q.setDeleted(q.id, true)
    await a.sync(); await b.sync()
    expect((await b.q.list()).data).toEqual([])
  })
  it('works offline and sends everything when the connection returns', async () => {
    const d = device(); const { s1, t1 } = await seed(d)
    await d.sync()
    server.down = true
    await d.q.create(input(s1.id, { topicIds: [t1.id] }))
    expect(await d.sync()).toMatchObject({ offline: true })
    expect((await d.store.pending()).count).toBe(2)
    expect((await d.q.list()).data).toHaveLength(1)
    server.down = false
    await d.sync()
    expect((await d.store.pending()).count).toBe(0)
    expect(serverRows('user_question_topics')).toHaveLength(1)
  })
  it('links that could not be read are read again on the next sync', async () => {
    const a = device(); const b = device()
    const { s1, t1 } = await seed(a)
    await a.q.create(input(s1.id, { topicIds: [t1.id] }))
    await a.sync()
    const real = server.fetchChildren
    server.fetchChildren = async () => ({ ok: false, message: 'Failed to fetch', transient: true })
    await b.sync()
    server.fetchChildren = real
    expect((await b.q.list()).data?.[0].topicIds).toEqual([])
    await b.sync()
    expect((await b.q.list()).data?.[0].topicIds).toEqual([t1.id])
  })
  it('a refused question can be discarded and the rest still syncs', async () => {
    const d = device(); const { s1 } = await seed(d)
    await d.sync()
    server.refuse = { code: '23514', message: 'rule broken' }
    await d.q.create(input(s1.id))
    const rep = await d.sync()
    expect((rep as { rejected: number }).rejected).toBe(1)
    server.refuse = null
    expect(await d.store.discardRejected()).toBe(1)
    expect((await d.q.list()).data).toEqual([])
  })
})
