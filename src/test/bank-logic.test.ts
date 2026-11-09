import { beforeEach, describe, expect, it } from 'vitest'
import { changedParts, restoreInput } from '../bank/history'
import { applyFilter, activeFilterCount, buildSearchIndex, EMPTY_FILTER, parseFilter, searchTerms, sortQuestions, type BankFilter } from '../bank/filter'
import { localSavedFilterRepo, MAX_SAVED_FILTERS, type SavedFilterRepo } from '../bank/saved'
import { localQuestionRepo, type WQuestion } from '../questions/repo'
import { localWorkspaceRepo } from '../workspace/localRepo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import type { VersionRow } from '../workspace/sync/remote'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

const q = (id: string, over: Partial<WQuestion> = {}): WQuestion => ({
  id, subjectId: 's1', type: 'SBA', stem: `Question ${id}`, difficulty: null,
  content: { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' },
  explanation: null, reference: null, topicIds: [], tagIds: [], archived: false, deleted: false, version: 1, updatedAt: `2026-11-09T0${id}:00:00Z`, ...over,
} as WQuestion)
const topics = [
  { id: 't1', subjectId: 's1', parentId: null, name: 'Heart', archived: false, rowVersion: 1 },
  { id: 't2', subjectId: 's1', parentId: 't1', name: 'Valves', archived: false, rowVersion: 1 },
]
const tags = [{ id: 'e1', category: 'exam' as const }, { id: 'g1', category: 'general' as const }]
const run = (list: WQuestion[], f: Partial<BankFilter>) => {
  const index = buildSearchIndex(list)
  return applyFilter(list, { ...EMPTY_FILTER, ...f }, { topics, tags, index }).map((x) => x.id)
}

describe('filter engine', () => {
  const list = [
    q('1', { stem: 'Which valve lies between the left atrium and ventricle?', topicIds: ['t2'], tagIds: ['e1'], difficulty: 'hard' }),
    q('2', { type: 'TRUE_FALSE', content: { correct_answer: true }, stem: 'The heart has four chambers.', topicIds: ['t1'], tagIds: ['g1'], difficulty: 'easy' }),
    q('3', { subjectId: 's2', stem: 'Renal blood flow', archived: true }),
    q('4', { stem: 'Deleted one', deleted: true }),
    q('5', { type: 'FILL_GAP', stem: 'The {{b1}} pumps blood.', content: { blanks: [{ id: 'b1', accepted_answers: ['heart', 'cardiac muscle'] }] }, explanation: 'Muscular pump' }),
  ]
  it('shows active questions only by default and never deleted ones', () => {
    expect(run(list, {})).toEqual(['1', '2', '5'])
    expect(run(list, { state: 'archived' })).toEqual(['3'])
    expect(run(list, { state: 'all' })).toEqual(['1', '2', '3', '5'])
  })
  it('search matches wording, options, accepted answers and explanation, case-insensitively, all words required', () => {
    expect(run(list, { text: 'VALVE atrium' })).toEqual(['1'])
    expect(run(list, { text: 'beta' })).toEqual(['1', '2', '5'].filter((id) => id !== '2' && id !== '5')) // options live only in SBA content
    expect(run(list, { text: 'cardiac' })).toEqual(['5'])
    expect(run(list, { text: 'muscular' })).toEqual(['5'])
    expect(run(list, { text: '"four chambers"' })).toEqual(['2'])
    expect(run(list, { text: 'chambers valve' })).toEqual([])
  })
  it('a topic includes its sub-topics; noTopic finds unclassified', () => {
    expect(run(list, { topicIds: ['t1'] })).toEqual(['1', '2'])
    expect(run(list, { topicIds: ['t2'] })).toEqual(['1'])
    expect(run(list, { noTopic: true })).toEqual(['5'])
  })
  it('groups are AND, choices inside a group are OR', () => {
    expect(run(list, { types: ['SBA', 'TRUE_FALSE'], difficulties: ['hard'] })).toEqual(['1'])
    expect(run(list, { difficulties: ['hard', 'easy'] })).toEqual(['1', '2'])
    expect(run(list, { difficulties: ['none'] })).toEqual(['5'])
    expect(run(list, { subjectIds: ['s2'], state: 'all' })).toEqual(['3'])
  })
  it('exam and general tags, Universal, and untagged', () => {
    expect(run(list, { examTagIds: ['e1'] })).toEqual(['1'])
    expect(run(list, { generalTagIds: ['g1'] })).toEqual(['2'])
    expect(run(list, { universal: 'only' })).toEqual(['2', '5'])
    expect(run(list, { universal: 'exam' })).toEqual(['1'])
    expect(run(list, { noTags: true })).toEqual(['5'])
  })
  it('sorts by edited date or wording', () => {
    const l = [q('1', { stem: 'b', updatedAt: '2026-11-09T01:00:00Z' }), q('2', { stem: 'A', updatedAt: '2026-11-09T03:00:00Z' }), q('3', { stem: 'c10', updatedAt: '2026-11-09T02:00:00Z' }), q('4', { stem: 'c9', updatedAt: '2026-11-09T04:00:00Z' })]
    expect(sortQuestions(l, 'edited-new').map((x) => x.id)).toEqual(['4', '2', '3', '1'])
    expect(sortQuestions(l, 'edited-old').map((x) => x.id)).toEqual(['1', '3', '2', '4'])
    expect(sortQuestions(l, 'wording').map((x) => x.stem)).toEqual(['A', 'b', 'c9', 'c10'])
  })
  it('search terms keep quoted phrases and ignore extra spacing', () => {
    expect(searchTerms('  Left   "atrial  septum"  valve ')).toEqual(['left', 'atrial septum', 'valve'])
  })
  it('the search index is reused for unchanged questions', () => {
    const a = buildSearchIndex(list)
    const b = buildSearchIndex(list, a)
    expect(b.get('1')).toBe(a.get('1'))
    const edited = list.map((x) => (x.id === '1' ? { ...x, stem: 'changed', updatedAt: 'later' } : x))
    expect(buildSearchIndex(edited, a).get('1')).not.toBe(a.get('1'))
  })
  it('counts active filter groups and reads a saved filter defensively', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTER, text: 'x', types: ['SBA'], state: 'all' })).toBe(3)
    expect(parseFilter({ text: 'x', types: ['SBA', 'BOGUS'], extra: 1, state: 'weird' })).toMatchObject({ text: 'x', types: [], state: 'active' })
    expect(parseFilter(null)).toEqual(EMPTY_FILTER)
    expect(parseFilter('nope')).toEqual(EMPTY_FILTER)
  })
  it('stays fast on 20,000 questions', () => {
    const big = Array.from({ length: 20000 }, (_, i) => q(String(i), { stem: `Statement number ${i} about ${i % 7 === 0 ? 'valve' : 'kidney'}`, updatedAt: `2026-11-09T00:${String(i % 60).padStart(2, '0')}:00Z`, tagIds: i % 3 ? ['g1'] : [] }))
    const t0 = performance.now()
    const index = buildSearchIndex(big)
    const t1 = performance.now()
    const hits = applyFilter(big, { ...EMPTY_FILTER, text: 'valve', generalTagIds: ['g1'] }, { topics, tags, index })
    const t2 = performance.now()
    expect(hits.length).toBeGreaterThan(1000)
    expect(t1 - t0).toBeLessThan(3000)
    expect(t2 - t1).toBeLessThan(500)
  })
})

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 9, 5, 0, ++t))
let server: FakeServer
let store: WorkspaceStore
let repo: SavedFilterRepo
beforeEach(() => { t = 0; server = fakeServer(); store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock); repo = localSavedFilterRepo(store) })
const serverRows = (n: string) => [...(server.tables.get(n)?.values() ?? [])]

describe('saved filters', () => {
  it('creates, lists, updates, renames and removes', async () => {
    const f: BankFilter = { ...EMPTY_FILTER, text: 'valve', types: ['SBA'] }
    const made = (await repo.create('  Valve  questions ', f, 'wording')).data!
    expect(made).toMatchObject({ name: 'Valve  questions', sort: 'wording', filter: f })
    expect((await repo.list()).data).toHaveLength(1)
    expect((await repo.update(made.id, { ...f, text: 'mitral' }, 'edited-old')).data).toMatchObject({ sort: 'edited-old', filter: { text: 'mitral' } })
    expect((await repo.rename(made.id, 'Mitral')).data?.name).toBe('Mitral')
    expect((await repo.remove(made.id)).error).toBeNull()
    expect((await repo.list()).data).toEqual([])
    expect((await repo.remove(made.id)).error).toBeNull()
  })
  it('names must be present, short, and unique ignoring case and spacing', async () => {
    await repo.create('Weak topics', EMPTY_FILTER, 'edited-new')
    expect((await repo.create('weak   TOPICS', EMPTY_FILTER, 'edited-new')).error).toMatch(/already have/)
    expect((await repo.create('  ', EMPTY_FILTER, 'edited-new')).error).toMatch(/Write a name/)
    expect((await repo.create('x'.repeat(81), EMPTY_FILTER, 'edited-new')).error).toMatch(/80/)
    const other = (await repo.create('Other', EMPTY_FILTER, 'edited-new')).data!
    expect((await repo.rename(other.id, 'WEAK topics')).error).toMatch(/already have/)
  })
  it('keeps at most 100', async () => {
    for (let i = 0; i < MAX_SAVED_FILTERS; i++) await repo.create(`f${i}`, EMPTY_FILTER, 'edited-new')
    expect((await repo.create('one more', EMPTY_FILTER, 'edited-new')).error).toMatch(/at most 100/)
  })
  it('syncs to a server that has the table, and a second device receives it', async () => {
    await repo.create('Hard ones', { ...EMPTY_FILTER, difficulties: ['hard'] }, 'wording')
    await runWorkspaceSync(store, server)
    expect(serverRows('user_saved_filters')).toHaveLength(1)
    const b = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
    await runWorkspaceSync(b, server)
    expect((await localSavedFilterRepo(b).list()).data?.[0]).toMatchObject({ name: 'Hard ones', sort: 'wording', filter: { difficulties: ['hard'] } })
  })
  it('before migration M7: sync skips the missing table quietly, nothing is lost, and it is sent once the table exists', async () => {
    server.missingTables.add('user_saved_filters')
    await repo.create('Waiting', EMPTY_FILTER, 'edited-new')
    const report = await runWorkspaceSync(store, server)
    expect(report.errors).toEqual([])
    expect(report.offline).toBe(false)
    expect(serverRows('user_saved_filters')).toHaveLength(0)
    expect((await store.backend.getAll('user_saved_filters'))[0].dirty).toBeTruthy()
    expect((await repo.list()).data).toHaveLength(1)
    server.missingTables.delete('user_saved_filters')
    await runWorkspaceSync(store, server)
    expect(serverRows('user_saved_filters').map((r) => r.name)).toEqual(['Waiting'])
  })
  it('other tables still sync while the saved-filter table is missing', async () => {
    server.missingTables.add('user_saved_filters')
    await store.create('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null })
    await repo.create('Waiting', EMPTY_FILTER, 'edited-new')
    const report = await runWorkspaceSync(store, server)
    expect(report.errors).toEqual([])
    expect(serverRows('user_subjects')).toHaveLength(1)
  })
})

describe('history helpers', () => {
  const v = (n: number, over: Partial<VersionRow> = {}): VersionRow => ({
    version: n, question_type: 'SBA', stem: 'Old wording', difficulty: null, content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'a' },
    explanation: null, reference: null, subject_id: 's1', subject_name: 'Anatomy', created_at: '2026-11-09T00:00:00Z', ...over,
  })
  it('names what changed between versions', () => {
    expect(changedParts(undefined, v(1))).toEqual([])
    expect(changedParts(v(1), v(2, { stem: 'New' }))).toEqual(['wording'])
    expect(changedParts(v(1), v(2, { content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'b' }, explanation: 'x', difficulty: 'hard', reference: 'r' }))).toEqual(['answers', 'explanation', 'reference', 'difficulty'])
    expect(changedParts(v(1), v(2, { explanation: '' }))).toEqual([])
  })
  it('restoring builds the next version from an old one, keeping subject, topics and tags, and refuses a different type', () => {
    const cur = q('1', { topicIds: ['t1'], subjectId: 's9' })
    const r = restoreInput(cur, v(1, { stem: 'Back then', difficulty: 'hard', explanation: 'why' }))
    expect(r).toMatchObject({ ok: true, input: { subjectId: 's9', topicIds: ['t1'], stem: 'Back then', difficulty: 'hard', explanation: 'why', type: 'SBA' } })
    expect(restoreInput(cur, v(1, { question_type: 'TRUE_FALSE' }))).toMatchObject({ ok: false })
  })
})

describe('bulk state and move (repo)', () => {
  const setup = async () => {
    const st = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
    const ws = localWorkspaceRepo(st)
    const qs = localQuestionRepo(st)
    const a = (await ws.createSubject('Anatomy', null)).data!
    const b = (await ws.createSubject('Physiology', null)).data!
    const topic = (await ws.createTopic(a.id, null, 'Heart')).data!
    const mk = async (stem: string, topicIds: string[] = []) =>
      (await qs.create({ subjectId: a.id, type: 'TRUE_FALSE', stem, difficulty: null, content: { correct_answer: true }, explanation: null, reference: null, topicIds })).data!
    return { st, ws, qs, a, b, topic, mk }
  }
  it('archives, restores, deletes and undeletes many; counts only real changes', async () => {
    const { qs, mk } = await setup()
    const x = await mk('One?'); const y = await mk('Two?')
    expect((await qs.bulkState([x.id, y.id], { archived: true })).data).toEqual({ changed: 2 })
    expect((await qs.bulkState([x.id, y.id], { archived: true })).data).toEqual({ changed: 0 })
    expect((await qs.bulkState([x.id], { archived: false })).data).toEqual({ changed: 1 })
    expect((await qs.bulkState([x.id, y.id], { deleted: true })).data).toEqual({ changed: 2 })
    expect((await qs.list()).data).toEqual([])
    expect((await qs.bulkState([x.id, y.id, 'ghost'], { deleted: false })).data).toEqual({ changed: 2 })
    expect((await qs.list()).data).toHaveLength(2)
  })
  it('moving to another subject clears topics, keeps tags and skips questions already there', async () => {
    const { qs, a, b, topic, mk } = await setup()
    const x = await mk('One?', [topic.id]); const y = await mk('Two?')
    expect((await qs.bulkMove([x.id, y.id], b.id)).data).toEqual({ changed: 2, topicsCleared: 1 })
    const moved = (await qs.get(x.id)).data!
    expect(moved).toMatchObject({ subjectId: b.id, topicIds: [] })
    expect((await qs.bulkMove([x.id], b.id)).data).toEqual({ changed: 0, topicsCleared: 0 })
    expect((await qs.bulkMove([x.id], 'nope')).error).toMatch(/no longer exists/)
    expect(a.id).not.toBe(b.id)
  })
  it('a move syncs even though the question had topics (links are removed first)', async () => {
    const { st, qs, b, topic, mk } = await setup()
    const x = await mk('One?', [topic.id])
    await runWorkspaceSync(st, server)
    await qs.bulkMove([x.id], b.id)
    const report = await runWorkspaceSync(st, server)
    expect(report.errors).toEqual([])
    expect([...server.tables.get('user_questions')!.values()][0].subject_id).toBe(b.id)
    expect(server.tables.get('user_question_topics')!.size).toBe(0)
  })
})
