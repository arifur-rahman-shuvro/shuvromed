import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { localQuestionRepo, type QuestionInput } from '../questions/repo'
import { localWorkspaceRepo } from '../workspace/localRepo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 10, 13, 0, ++t))
let server: FakeServer
const SBA = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
beforeEach(() => { t = 0; server = fakeServer() })
const count = (name: string) => server.tables.get(name)?.size ?? 0
const calls = (prefix: string) => server.calls.filter((c) => c.startsWith(prefix)).length

async function bankOf(n: number) {
  const store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
  const ws = localWorkspaceRepo(store), qr = localQuestionRepo(store)
  const s = (await ws.createSubject('Anatomy', null)).data!
  const topic = (await ws.createTopic(s.id, null, 'Heart')).data!
  const inputs: QuestionInput[] = Array.from({ length: n }, (_, i) => ({ subjectId: s.id, type: 'SBA', difficulty: null, stem: `Question ${i}`, content: SBA, explanation: null, reference: null, topicIds: [topic.id] }))
  await qr.createMany(inputs)
  return { store, qr, s, topic }
}

describe('sync sends new rows in batches', () => {
  it('250 new questions with their topic links go in a handful of requests, not hundreds', async () => {
    const { store } = await bankOf(250)
    const r = await runWorkspaceSync(store, server)
    expect(r.errors).toEqual([])
    expect(count('user_questions')).toBe(250)
    expect(count('user_question_topics')).toBe(250)
    expect(calls('insertMany user_questions')).toBe(3) // 100 + 100 + 50
    expect(calls('insertMany user_question_topics')).toBe(3)
    expect(calls('insert user_questions')).toBe(0)
    expect((await store.pending()).count).toBe(0)
    // every question learned its server version
    expect((await localQuestionRepo(store).list()).data!.every((q) => q.version === 1 && !q.pendingEdit)).toBe(true)
  })

  it('a second device receives exactly the same bank', async () => {
    const { store } = await bankOf(130)
    await runWorkspaceSync(store, server)
    const other = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
    await runWorkspaceSync(other, server)
    const list = (await localQuestionRepo(other).list()).data!
    expect(list).toHaveLength(130)
    expect(list.every((q) => q.topicIds.length === 1)).toBe(true)
  })

  it('when the server refuses one row of a batch, only that row is refused and the others are saved', async () => {
    const { store, qr, s } = await bankOf(0)
    const good = Array.from({ length: 12 }, (_, i) => ({ subjectId: s.id, type: 'SBA' as const, difficulty: null, stem: `Fine ${i}`, content: SBA, explanation: null, reference: null, topicIds: [] }))
    await qr.createMany(good)
    // sneak in one answer for a question version the server has never heard of
    const first = (await qr.list()).data![0]
    await runWorkspaceSync(store, server) // questions first
    const rows = Array.from({ length: 6 }, (_, i) => ({ table: 'user_question_attempts', id: `att-${i}`, create: {
      question_id: first.id, question_version: i === 3 ? 9 : 1, response: {}, score: 1, max_score: 1, outcome: 'correct', confidence: null, time_ms: 1000, mode: 'practice', session_id: null, attempted_at: '2026-11-10T00:00:00Z' } }))
    await store.apply(rows)
    server.tables.set('user_sessions', server.tables.get('user_sessions') ?? new Map())
    const r = await runWorkspaceSync(store, server)
    expect(calls('insertMany user_question_attempts')).toBe(1)
    expect(count('user_question_attempts')).toBe(5)
    expect(r.rejected).toBe(1)
    const bad = (await store.backend.getAll('user_question_attempts')).filter((x) => x.rejected)
    expect(bad.map((x) => x.id)).toEqual(['att-3'])
  })

  it('a dropped connection during a batch loses nothing, and the retry does not create duplicates', async () => {
    const { store } = await bankOf(150)
    server.down = true
    const off = await runWorkspaceSync(store, server)
    expect(off.offline).toBe(true)
    expect(count('user_questions')).toBe(0)
    expect((await store.pending()).count).toBeGreaterThan(0)
    server.down = false
    const ok = await runWorkspaceSync(store, server)
    expect(ok.errors).toEqual([])
    expect(count('user_questions')).toBe(150)
    expect((await store.pending()).count).toBe(0)
  })

  it('a batch the server saved but never answered is recognised on the retry', async () => {
    const { store } = await bankOf(150)
    server.loseNextAck = true // the first saved question is not confirmed: the device hears a network error
    const first = await runWorkspaceSync(store, server)
    expect(first.offline).toBe(true)
    const again = await runWorkspaceSync(store, server)
    expect(again.errors).toEqual([])
    expect(again.rejected).toBe(0)
    expect(count('user_questions')).toBe(150)
    expect(count('user_question_topics')).toBe(150)
    expect((await store.pending()).count).toBe(0)
    expect((await store.backend.getAll('user_questions')).some((r) => r.rejected)).toBe(false)
  })

  it('changes to existing rows are still sent one at a time', async () => {
    const { store, qr } = await bankOf(3)
    await runWorkspaceSync(store, server)
    server.calls.length = 0
    const q = (await qr.list()).data![0]
    await qr.update(q.id, { subjectId: q.subjectId, type: q.type, stem: `${q.stem} edited`, difficulty: q.difficulty, content: q.content, explanation: q.explanation, reference: q.reference, topicIds: q.topicIds, tagIds: q.tagIds })
    await runWorkspaceSync(store, server)
    expect(calls('update user_questions')).toBe(1)
    expect(calls('insertMany')).toBe(0)
  })
})
