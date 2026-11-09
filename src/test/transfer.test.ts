import { beforeEach, describe, expect, it } from 'vitest'
import { localQuestionRepo } from '../questions/repo'
import { grade } from '../questions/grade'
import { localTagRepo } from '../tags/repo'
import { buildExport, exportFileName } from '../transfer/export'
import { readJsonFile } from '../transfer/file'
import { PROMPT_KIT } from '../transfer/kit'
import { readPaste } from '../transfer/paste'
import { buildPlan, type Snapshot } from '../transfer/plan'
import { runImport } from '../transfer/run'
import { localWorkspaceRepo } from '../workspace/localRepo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

const empty: Snapshot = { subjects: [], topics: [], tags: [], questions: [] }
const SBA_TEXT = `Subject: Anatomy
Topic: Thorax > Heart
Exam: FCPS Part 1
Tags: high yield
Difficulty: hard

Q: Which valve lies between the left atrium and ventricle?
A) Tricuspid
B) Mitral *
C) Aortic
Explanation: The bicuspid valve.
Reference: Gray's
---`

describe('paste reader', () => {
  it('reads a single-best-answer question with defaults, explanation and reference', () => {
    const r = readPaste(SBA_TEXT)
    expect(r.failures).toEqual([])
    expect(r.items).toHaveLength(1)
    expect(r.items[0].item).toMatchObject({
      subject: 'Anatomy', topics: [['Thorax', 'Heart']], examTags: ['FCPS Part 1'], generalTags: ['high yield'], type: 'SBA', difficulty: 'hard',
      explanation: 'The bicuspid valve.', reference: "Gray's",
      content: { options: [{ id: 'a', text: 'Tricuspid' }, { id: 'b', text: 'Mitral' }, { id: 'c', text: 'Aortic' }], correct_option_id: 'b' },
    })
  })
  it('defaults carry to later questions until changed; a new subject clears the topic', () => {
    const r = readPaste(`Subject: Anatomy\nTopic: Heart\nQ: One?\nA) x *\nB) y\n---\nQ: Two?\nA) x\nB) y *\n---\nSubject: Physiology\nQ: Three?\nA) x *\nB) y`)
    expect(r.items.map((i) => [i.item.subject, i.item.topics.length])).toEqual([['Anatomy', 1], ['Anatomy', 1], ['Physiology', 0]])
  })
  it('a new Q: closes the previous question even without ---', () => {
    const r = readPaste(`Subject: S\nQ: One?\nA) x *\nB) y\nQ: Two?\nA) x\nB) y *`)
    expect(r.items).toHaveLength(2)
  })
  it('Answer: line, several letters, letter runs, and Type: Multiple', () => {
    const r = readPaste(`Subject: S\nQ: Pick\nA) a\nB) b\nC) c\nAnswer: A, C\n---\nQ: Pick2\nA) a\nB) b\nC) c\nAnswer: BC\n---\nQ: One\nA) a\nB) b\nAnswer: b`)
    expect(r.items.map((i) => i.item.type)).toEqual(['MULTIPLE_MCQ', 'MULTIPLE_MCQ', 'SBA'])
    expect(r.items[0].item.content).toMatchObject({ correct_option_ids: ['a', 'c'] })
    expect(r.items[1].item.content).toMatchObject({ correct_option_ids: ['b', 'c'] })
  })
  it('true/false and fill-the-gap, with alternatives and several gaps', () => {
    const r = readPaste(`Subject: S\nQ: The heart has four chambers.\nAnswer: True\n---\nQ: The [heart|cardiac muscle] pumps [blood].\n---\nQ: Sky\nAnswer: f`)
    expect(r.failures).toEqual([])
    expect(r.items[0].item).toMatchObject({ type: 'TRUE_FALSE', content: { correct_answer: true } })
    expect(r.items[1].item).toMatchObject({ type: 'FILL_GAP', stem: 'The {{b1}} pumps {{b2}}.', content: { blanks: [{ id: 'b1', accepted_answers: ['heart', 'cardiac muscle'] }, { id: 'b2', accepted_answers: ['blood'] }] } })
    expect(r.items[2].item).toMatchObject({ content: { correct_answer: false } })
  })
  it('joins wrapped lines of the question, an option and the explanation', () => {
    const r = readPaste(`Subject: S\nQ: A long\nquestion?\nA) first part\nsecond part *\nB) other\nExplanation: line one\nline two`)
    expect(r.items[0].item.stem).toBe('A long\nquestion?')
    expect(r.items[0].item.explanation).toBe('line one\nline two')
    expect(r.items[0].item.content).toMatchObject({ options: [{ text: 'first part second part' }, { text: 'other' }] })
  })
  it('explains what is wrong with each bad question, with its line', () => {
    const r = readPaste(`Q: No subject\nA) x *\nB) y\n---\nSubject: S\nQ: No answer\nA) x\nB) y\n---\nQ: Nothing to go on\n---\nQ: Too few\nA) only *`)
    expect(r.items).toHaveLength(0)
    expect(r.failures.map((f) => f.problems.join(' '))).toEqual([
      expect.stringMatching(/No subject/), expect.stringMatching(/Mark the correct option/), expect.stringMatching(/Could not tell the type/), expect.stringMatching(/at least 2 options/),
    ])
    expect(r.failures[0].label).toMatch(/line 1/)
  })
  it('reports stray lines and empty input', () => {
    expect(readPaste('   \n').fatal).toMatch(/Paste some questions/)
    expect(readPaste('hello world').failures[0].problems[0]).toMatch(/outside any question/)
  })
  it('the prompt kit example parses cleanly into three valid questions', () => {
    const example = PROMPT_KIT.slice(PROMPT_KIT.indexOf('EXAMPLE') + 8, PROMPT_KIT.indexOf('MY NOTES'))
    const r = readPaste(example)
    expect(r.failures).toEqual([])
    expect(r.items.map((i) => i.item.type)).toEqual(['SBA', 'TRUE_FALSE', 'FILL_GAP'])
    const plan = buildPlan(r, empty)
    expect(plan.counts).toEqual({ add: 3, duplicate: 0, error: 0 })
    expect(plan.newSubjects).toEqual(['Anatomy'])
    expect(plan.newTopics).toEqual(['Anatomy › Thorax', 'Anatomy › Thorax › Heart'])
    expect(plan.newTags).toEqual([{ category: 'exam', name: 'FCPS Part 1' }])
  })
})

describe('JSON reader', () => {
  const q = { subject: 'A', type: 'TRUE_FALSE', stem: 'x', content: { correct_answer: true } }
  it('reads a file and skips a bad question while keeping the rest', () => {
    const r = readJsonFile(JSON.stringify({ format: 'shuvromed-questions', version: 1, questions: [q, { subject: 'A', type: 'WRONG', stem: 'y', content: {} }, q] }))
    expect(r.items).toHaveLength(2)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].label).toBe('Question 2')
  })
  it('refuses a wrong or newer file clearly', () => {
    expect(readJsonFile('nope').fatal).toMatch(/not a valid JSON/)
    expect(readJsonFile('{"format":"other"}').fatal).toMatch(/not a ShuvroMed question file/)
    expect(readJsonFile('{"format":"shuvromed-questions","version":9,"questions":[]}').fatal).toMatch(/newer version/)
    expect(readJsonFile('{"format":"shuvromed-questions","version":1}').fatal).toMatch(/no list/)
  })
  it('accepts a bare list of questions', () => {
    expect(readJsonFile(JSON.stringify([q])).items).toHaveLength(1)
  })
})

describe('dry-run plan', () => {
  const snap = (): Snapshot => ({
    subjects: [{ id: 's1', name: 'Anatomy', description: null, archived: false, rowVersion: 1 }],
    topics: [{ id: 't1', subjectId: 's1', parentId: null, name: 'Heart', archived: false, rowVersion: 1 }],
    tags: [{ id: 'g1', category: 'general', name: 'High yield', archived: false, uses: 0 }],
    questions: [{ stem: 'Existing  QUESTION?' }],
  })
  it('lists only what is missing, ignoring case and spacing', () => {
    const r = readPaste(`Subject: anatomy\nTopic: HEART > Valves\nTags: high  yield, new tag\nQ: Fresh?\nAnswer: True`)
    const p = buildPlan(r, snap())
    expect(p.newSubjects).toEqual([])
    expect(p.newTopics).toEqual(['anatomy › HEART › Valves'])
    expect(p.newTags).toEqual([{ category: 'general', name: 'new tag' }])
  })
  it('skips duplicates of existing and of earlier questions by default, adds them when asked', () => {
    const r = readPaste(`Subject: S\nQ: existing question?\nAnswer: True\n---\nQ: Twice?\nAnswer: True\n---\nQ: twice?\nAnswer: False`)
    const skip = buildPlan(r, snap())
    expect(skip.items.map((i) => i.status)).toEqual(['duplicate', 'add', 'duplicate'])
    expect(skip.items.map((i) => i.duplicateOf)).toEqual(['existing', undefined, 'file'])
    expect(skip.newSubjects).toEqual(['S'])
    const add = buildPlan(r, snap(), { duplicates: 'add' })
    expect(add.counts).toEqual({ add: 3, duplicate: 0, error: 0 })
  })
  it('a skipped duplicate creates nothing', () => {
    const r = readPaste(`Subject: Brand new\nTags: x\nQ: Existing question?\nAnswer: True`)
    const p = buildPlan(r, snap())
    expect(p.newSubjects).toEqual([])
    expect(p.newTags).toEqual([])
  })
  it('catches contract problems per question', () => {
    const r = readJsonFile(JSON.stringify([
      { subject: 'A', type: 'SBA', stem: 'x', content: { options: [{ id: 'a', text: 'only' }], correct_option_id: 'a' } },
      { subject: '', type: 'TRUE_FALSE', stem: 'y', content: { correct_answer: true } },
      { subject: 'A', type: 'FILL_GAP', stem: 'no marker', content: { blanks: [{ id: 'b1', accepted_answers: ['x'] }] } },
    ]))
    const p = buildPlan(r, snap())
    expect(p.counts.error).toBe(3)
    expect(p.items.every((i) => i.status === 'error' && i.problems.length > 0)).toBe(true)
  })
  it('counts unreadable questions as errors too and passes a fatal file through', () => {
    expect(buildPlan({ items: [], failures: [], fatal: 'bad' }, snap()).fatal).toBe('bad')
  })
})

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 9, 2, 0, ++t))
let server: FakeServer
beforeEach(() => { t = 0; server = fakeServer() })
function device() {
  const store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
  const repos = { ws: localWorkspaceRepo(store), tags: localTagRepo(store), questions: localQuestionRepo(store) }
  const snapshot = async () => {
    const w = (await repos.ws.load()).data!
    return { subjects: w.subjects, topics: w.topics, tags: (await repos.tags.list()).data!, questions: (await repos.questions.list()).data! }
  }
  return { store, repos, snapshot, sync: () => runWorkspaceSync(store, server) }
}
const serverRows = (n: string) => [...(server.tables.get(n)?.values() ?? [])]

describe('import and export end to end', () => {
  it('imports pasted questions, creating what is missing, and syncs them', async () => {
    const d = device()
    const plan = buildPlan(readPaste(SBA_TEXT + `\nQ: The [heart] pumps blood.\n---\nQ: Four chambers?\nAnswer: True`), await d.snapshot())
    expect(plan.counts.add).toBe(3)
    const r = await runImport(plan, d.repos)
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ added: 3, createdSubjects: 1, createdTopics: 2, createdTags: 2, failed: [] })
    const list = (await d.repos.questions.list()).data!
    expect(list).toHaveLength(3)
    expect(list.every((q) => q.tagIds.length === 2 && q.topicIds.length === 1)).toBe(true)
    await d.sync()
    expect(serverRows('user_questions')).toHaveLength(3)
    expect(serverRows('user_question_topics')).toHaveLength(3)
    expect(serverRows('user_question_tag_links')).toHaveLength(6)
    expect(serverRows('user_subjects')).toHaveLength(1)
  })
  it('running the same import again adds nothing (duplicates skipped)', async () => {
    const d = device()
    await runImport(buildPlan(readPaste(SBA_TEXT), await d.snapshot()), d.repos)
    const again = buildPlan(readPaste(SBA_TEXT), await d.snapshot())
    expect(again.counts).toEqual({ add: 0, duplicate: 1, error: 0 })
    expect((await runImport(again, d.repos)).data?.added).toBe(0)
    expect((await d.repos.questions.list()).data).toHaveLength(1)
  })
  it('imports into existing subjects, topics and tags without duplicating them', async () => {
    const d = device()
    const s = (await d.repos.ws.createSubject('Anatomy', null)).data!
    await d.repos.ws.createTopic(s.id, null, 'Thorax')
    await d.repos.tags.create('exam', 'fcps part 1')
    const r = await runImport(buildPlan(readPaste(SBA_TEXT), await d.snapshot()), d.repos)
    expect(r.data).toMatchObject({ added: 1, createdSubjects: 0, createdTopics: 1, createdTags: 1 })
    expect((await d.repos.ws.load()).data?.topics.map((x) => x.name).sort()).toEqual(['Heart', 'Thorax'])
  })
  it('two questions sharing a new topic path create it once', async () => {
    const d = device()
    const r = await runImport(buildPlan(readPaste(`Subject: S\nTopic: A > B\nQ: One?\nAnswer: True\n---\nQ: Two?\nAnswer: False`), await d.snapshot()), d.repos)
    expect(r.data).toMatchObject({ added: 2, createdTopics: 2 })
  })
  it('a large import is saved in batches and reports progress', async () => {
    const d = device()
    const text = 'Subject: S\n' + Array.from({ length: 450 }, (_, i) => `Q: Statement ${i}?\nAnswer: True\n---`).join('\n')
    const plan = buildPlan(readPaste(text), await d.snapshot())
    const seen: number[] = []
    const r = await runImport(plan, d.repos, (done) => seen.push(done))
    expect(r.data?.added).toBe(450)
    expect(seen).toEqual([200, 400, 450])
  })
  it('exports everything and the export imports back into a fresh account with the same questions', async () => {
    const a = device()
    await runImport(buildPlan(readPaste(SBA_TEXT + `\nQ: The [heart|cardiac muscle] pumps blood.\n---\nQ: Four chambers?\nAnswer: True`), await a.snapshot()), a.repos)
    const dead = (await a.repos.questions.list()).data!.find((q) => q.stem.startsWith('Four'))!
    await a.repos.questions.setDeleted(dead.id, true)
    const file = buildExport(await a.snapshot(), new Date('2026-11-09T00:00:00Z'))
    expect(file).toMatchObject({ format: 'shuvromed-questions', version: 1, exported_at: '2026-11-09T00:00:00.000Z' })
    expect(file.questions).toHaveLength(2) // the deleted one is left out
    expect(file.questions[0]).toMatchObject({ subject: 'Anatomy', topics: [['Thorax', 'Heart']], exam_tags: ['FCPS Part 1'], tags: ['high yield'] })
    expect(exportFileName(new Date('2026-11-09T05:00:00Z'))).toBe('shuvromed-questions-2026-11-09.json')

    const b = device()
    const plan = buildPlan(readJsonFile(JSON.stringify(file)), await b.snapshot())
    expect(plan.counts).toEqual({ add: 2, duplicate: 0, error: 0 })
    await runImport(plan, b.repos)
    const imported = (await b.repos.questions.list()).data!
    expect(imported.map((q) => q.stem).sort()).toEqual(['The {{b1}} pumps blood.', 'Which valve lies between the left atrium and ventricle?'])
    const gap = imported.find((q) => q.type === 'FILL_GAP')!
    expect(grade({ question_type: gap.type, stem: gap.stem, content: gap.content }, { answers: { b1: ' Cardiac   Muscle ' } }).outcome).toBe('correct')
  })
  it('a question refused when saving is reported, the others still go in', async () => {
    const d = device()
    const plan = buildPlan(readPaste(`Subject: S\nQ: One?\nAnswer: True\n---\nQ: Two?\nAnswer: True`), await d.snapshot())
    const real = d.repos.questions.createMany
    d.repos.questions.createMany = async (inputs) => { const r = await real(inputs.slice(0, 1)); return { data: { created: r.data!.created, failed: [{ index: 1, error: 'Refused for a test' }] }, error: null } }
    const r = await runImport(plan, d.repos)
    expect(r.data).toMatchObject({ added: 1, failed: [{ label: expect.stringMatching(/Question 2/), error: 'Refused for a test' }] })
  })
})
