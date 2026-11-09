import { beforeEach, describe, expect, it } from 'vitest'
import { localQuestionRepo, type QuestionInput, type QuestionRepo } from '../questions/repo'
import type { QuestionContent } from '../questions/schema'
import { isUniversal, localTagRepo, type TagRepo } from '../tags/repo'
import { localWorkspaceRepo } from '../workspace/localRepo'
import type { WorkspaceRepo } from '../workspace/repo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 9, 1, 0, ++t))
let server: FakeServer
beforeEach(() => { t = 0; server = fakeServer() })

const SBA: QuestionContent = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
const input = (subjectId: string, over: Partial<QuestionInput> = {}): QuestionInput => ({
  subjectId, type: 'SBA', stem: 'Which is first?', difficulty: null, content: SBA, explanation: null, reference: null, topicIds: [], ...over,
})
interface Device { store: WorkspaceStore; ws: WorkspaceRepo; q: QuestionRepo; tags: TagRepo; sync: () => Promise<unknown> }
function device(): Device {
  const store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
  return { store, ws: localWorkspaceRepo(store), q: localQuestionRepo(store), tags: localTagRepo(store), sync: () => runWorkspaceSync(store, server) }
}
const serverRows = (table: string) => [...(server.tables.get(table)?.values() ?? [])]
async function seed(d: Device) {
  const s = (await d.ws.createSubject('Anatomy', null)).data!
  const exam = (await d.tags.create('exam', 'FCPS Part 1')).data!
  const exam2 = (await d.tags.create('exam', 'MBBS Final')).data!
  const gen = (await d.tags.create('general', 'High yield')).data!
  return { s, exam, exam2, gen }
}

describe('tag repo', () => {
  it('creates, renames, lists with use counts', async () => {
    const d = device(); const { s, exam } = await seed(d)
    await d.q.create(input(s.id, { tagIds: [exam.id] }))
    const list = (await d.tags.list()).data!
    expect(list.map((x) => [x.name, x.category, x.uses])).toEqual([['FCPS Part 1', 'exam', 1], ['High yield', 'general', 0], ['MBBS Final', 'exam', 0]])
    expect((await d.tags.rename(exam.id, ' FCPS 1 ')).data?.name).toBe('FCPS 1')
  })
  it('names are unique per group, ignoring case and spacing; the other group may reuse a name', async () => {
    const d = device(); await seed(d)
    expect((await d.tags.create('exam', 'fcps  part 1')).error).toMatch(/already exists/)
    expect((await d.tags.create('general', 'FCPS Part 1')).error).toBeNull()
    expect((await d.tags.create('general', '   ')).error).toMatch(/Write a name/)
    expect((await d.tags.create('general', 'x'.repeat(81))).error).toMatch(/80/)
  })
  it('rename onto an existing name in the same group is refused', async () => {
    const d = device(); const { exam2 } = await seed(d)
    expect((await d.tags.rename(exam2.id, 'FCPS Part 1')).error).toMatch(/already exists/)
  })
  it('archive and restore', async () => {
    const d = device(); const { gen } = await seed(d)
    expect((await d.tags.setArchived(gen.id, true)).data?.archived).toBe(true)
    expect((await d.tags.setArchived(gen.id, false)).data?.archived).toBe(false)
  })
  it('deleting a tag removes its links but keeps the questions; no exam tag left means Universal', async () => {
    const d = device(); const { s, exam, gen } = await seed(d)
    const q = (await d.q.create(input(s.id, { tagIds: [exam.id, gen.id] }))).data!
    const r = await d.tags.remove(exam.id)
    expect(r.data).toEqual({ removedLinks: 1 })
    const after = (await d.q.get(q.id)).data!
    expect(after.tagIds).toEqual([gen.id])
    expect(isUniversal(after.tagIds, (await d.tags.list()).data!)).toBe(true)
  })
})

describe('universal rule', () => {
  const tags = [{ id: 'e', category: 'exam' as const }, { id: 'g', category: 'general' as const }]
  it('no tags and general-only are Universal; any exam tag is not', () => {
    expect(isUniversal([], tags)).toBe(true)
    expect(isUniversal(['g'], tags)).toBe(true)
    expect(isUniversal(['g', 'e'], tags)).toBe(false)
  })
})

describe('question tags', () => {
  it('saves tags with the question, keeps them when tagIds is left out, replaces them when given', async () => {
    const d = device(); const { s, exam, exam2, gen } = await seed(d)
    const q = (await d.q.create(input(s.id, { tagIds: [exam.id, gen.id] }))).data!
    expect(q.tagIds.sort()).toEqual([exam.id, gen.id].sort())
    expect((await d.q.update(q.id, input(s.id, { stem: 'New wording?' }))).data?.tagIds.sort()).toEqual([exam.id, gen.id].sort())
    expect((await d.q.update(q.id, input(s.id, { stem: 'New wording?', tagIds: [exam2.id] }))).data?.tagIds).toEqual([exam2.id])
  })
  it('refuses an unknown tag and leaves nothing half saved', async () => {
    const d = device(); const { s } = await seed(d)
    expect((await d.q.create(input(s.id, { tagIds: ['nope'] }))).error).toMatch(/tags no longer exists/)
    expect((await d.q.list()).data).toEqual([])
    expect(await d.store.list('user_question_tag_links')).toHaveLength(0)
  })
  it('removing then re-adding the same tag before a sync works', async () => {
    const d = device(); const { s, exam } = await seed(d)
    const q = (await d.q.create(input(s.id, { tagIds: [exam.id] }))).data!
    await d.sync()
    await d.q.update(q.id, input(s.id, { tagIds: [] }))
    expect((await d.q.update(q.id, input(s.id, { tagIds: [exam.id] }))).error).toBeNull()
    await d.sync()
    expect(serverRows('user_question_tag_links')).toHaveLength(1)
  })
})

describe('bulk tags', () => {
  it('adds and removes tags on many questions at once, counting only real changes', async () => {
    const d = device(); const { s, exam, exam2, gen } = await seed(d)
    const a = (await d.q.create(input(s.id, { stem: 'A?', tagIds: [exam.id] }))).data!
    const b = (await d.q.create(input(s.id, { stem: 'B?' }))).data!
    const r = await d.q.bulkTags([a.id, b.id], { add: [exam.id, gen.id], remove: [exam2.id] })
    expect(r.data).toEqual({ changed: 2 })
    expect((await d.q.get(a.id)).data?.tagIds.sort()).toEqual([exam.id, gen.id].sort())
    expect((await d.q.get(b.id)).data?.tagIds.sort()).toEqual([exam.id, gen.id].sort())
    expect((await d.q.bulkTags([a.id, b.id], { add: [exam.id] })).data).toEqual({ changed: 0 })
    expect((await d.q.bulkTags([a.id, b.id], { remove: [exam.id, gen.id] })).data).toEqual({ changed: 2 })
  })
  it('refuses add and remove of the same tag, or an unknown tag, and changes nothing', async () => {
    const d = device(); const { s, exam } = await seed(d)
    const a = (await d.q.create(input(s.id))).data!
    expect((await d.q.bulkTags([a.id], { add: [exam.id], remove: [exam.id] })).error).toMatch(/same tag/)
    expect((await d.q.bulkTags([a.id], { add: ['nope'] })).error).toMatch(/no longer exists/)
    expect((await d.q.get(a.id)).data?.tagIds).toEqual([])
  })
  it('skips deleted questions', async () => {
    const d = device(); const { s, exam } = await seed(d)
    const a = (await d.q.create(input(s.id))).data!
    await d.q.setDeleted(a.id, true)
    expect((await d.q.bulkTags([a.id], { add: [exam.id] })).data).toEqual({ changed: 0 })
  })
})

describe('tag sync', () => {
  it('sends tags then links, and a second device receives them', async () => {
    const a = device(); const { s, exam, gen } = await seed(a)
    await a.q.create(input(s.id, { tagIds: [exam.id, gen.id] }))
    await a.sync()
    expect(serverRows('user_tags').map((r) => r.name).sort()).toEqual(['FCPS Part 1', 'High yield', 'MBBS Final'])
    expect(serverRows('user_question_tag_links')).toHaveLength(2)
    const b = device(); await b.sync()
    const q = (await b.q.list()).data![0]
    expect(q.tagIds).toHaveLength(2)
    expect((await b.tags.list()).data).toHaveLength(3)
  })
  it('tag changes do not make a new question version', async () => {
    const d = device(); const { s, exam } = await seed(d)
    const q = (await d.q.create(input(s.id))).data!
    await d.sync()
    await d.q.bulkTags([q.id], { add: [exam.id] })
    await d.sync()
    expect(serverRows('user_questions')[0].current_version).toBe(1)
  })
  it('deleting a tag on one device removes the links on the other after sync', async () => {
    const a = device(); const { s, exam } = await seed(a)
    await a.q.create(input(s.id, { tagIds: [exam.id] }))
    await a.sync()
    const b = device(); await b.sync()
    await a.tags.remove(exam.id)
    await a.sync()
    expect(serverRows('user_question_tag_links')).toHaveLength(0)
    await b.sync()
    expect((await b.q.list()).data![0].tagIds).toEqual([])
    expect((await b.tags.list()).data!.map((x) => x.name)).not.toContain('FCPS Part 1')
  })
  it('a tag name used on two devices is refused on the second and can be discarded', async () => {
    const a = device(); const b = device()
    await a.tags.create('exam', 'FCPS'); await a.sync()
    await b.tags.create('exam', 'fcps'); await b.sync()
    expect(serverRows('user_tags')).toHaveLength(1)
    expect((await b.store.list('user_tags')).length).toBeGreaterThan(0)
  })
})
