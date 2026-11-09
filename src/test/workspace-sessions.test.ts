import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTER } from '../bank/filter'
import { localQuestionRepo, type QuestionInput, type QuestionRepo, type WQuestion } from '../questions/repo'
import type { QuestionContent } from '../questions/schema'
import { gradeAnswer, summarize, formatClock, formatDuration } from '../session/score'
import { eligibleForSession, pickQuestions, versionToStamp } from '../session/select'
import { localSessionRepo, type SessionRepo } from '../session/repo'
import { DEFAULT_CONFIG, parseConfig, parseState, type SessionConfig } from '../session/types'
import { localWorkspaceRepo } from '../workspace/localRepo'
import type { WorkspaceRepo } from '../workspace/repo'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

describe('session config and state are read defensively', () => {
  it('fills in defaults, clamps, and forces an exam to show results at the end', () => {
    expect(parseConfig(undefined)).toMatchObject({ mode: 'practice', count: 20, feedback: 'immediate', timeLimitMinutes: null, negativeMarking: true })
    expect(parseConfig({ mode: 'exam', count: 9999, timeLimitMinutes: 99999, feedback: 'immediate' })).toMatchObject({ mode: 'exam', count: 500, timeLimitMinutes: 1440, feedback: 'end' })
    expect(parseConfig({ mode: 'practice', timeLimitMinutes: 30 }).timeLimitMinutes).toBeNull()
    expect(parseConfig({ count: 'x', shuffleQuestions: 'yes', filter: 'junk' })).toMatchObject({ count: 20, shuffleQuestions: true, filter: EMPTY_FILTER })
  })
  it('reads a saved state and drops what does not belong', () => {
    const s = parseState({ index: 99, answers: { a: { response: { selected: 'x' }, ms: 5, outcome: 'correct', score: 1 }, b: 7, c: { ms: -5, outcome: 'weird' } } }, 3)
    expect(s.index).toBe(2)
    expect(s.answers.a).toMatchObject({ outcome: 'correct', score: 1, ms: 5 })
    expect(s.answers.b).toBeUndefined()
    expect(s.answers.c).toMatchObject({ ms: 0, outcome: undefined })
    expect(parseState(null, 0)).toEqual({ index: 0, answers: {} })
  })
})

const q = (id: string, over: Partial<WQuestion> = {}): WQuestion => ({
  id, subjectId: 's1', type: 'SBA', stem: `Q${id}`, difficulty: null, content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'a' },
  explanation: null, reference: null, topicIds: [], tagIds: [], pendingEdit: false, version: 1, archived: false, deleted: false, updatedAt: '2026-11-09T00:00:00Z', ...over,
} as WQuestion)

describe('choosing questions', () => {
  it('leaves out archived, deleted, and questions with an unsent edit; counts the waiting ones', () => {
    const r = eligibleForSession([q('1'), q('2', { archived: true }), q('3', { deleted: true }), q('4', { pendingEdit: true }), q('5', { version: null, pendingEdit: true })])
    expect(r.eligible.map((x) => x.id)).toEqual(['1', '5'])
    expect(r.waiting).toBe(1)
  })
  it('stamps the server version, or 1 for a question that has never been sent', () => {
    expect(versionToStamp({ version: 4 })).toBe(4)
    expect(versionToStamp({ version: null })).toBe(1)
  })
  it('same seed gives the same pick; unshuffled takes the first ones', () => {
    const list = Array.from({ length: 30 }, (_, i) => q(String(i)))
    const a = pickQuestions(list, 10, 7, true).map((x) => x.id)
    expect(pickQuestions(list, 10, 7, true).map((x) => x.id)).toEqual(a)
    expect(pickQuestions(list, 10, 8, true).map((x) => x.id)).not.toEqual(a)
    expect(pickQuestions(list, 3, 1, false).map((x) => x.id)).toEqual(['0', '1', '2'])
    expect(pickQuestions(list, 99, 1, true)).toHaveLength(30)
  })
})

describe('scoring', () => {
  const sba = q('1', { content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'a', scoring: { negative_marks: 0.25 } } as QuestionContent })
  it('negative marking can be switched off for the whole session', () => {
    expect(gradeAnswer(sba, { selected: 'b' }, true)).toMatchObject({ score: -0.25, outcome: 'incorrect' })
    expect(gradeAnswer(sba, { selected: 'b' }, false)).toMatchObject({ score: 0, outcome: 'incorrect' })
    expect(gradeAnswer(sba, { selected: 'a' }, false)).toMatchObject({ score: 1, outcome: 'correct' })
    expect(gradeAnswer(sba, null, true)).toMatchObject({ score: 0, outcome: 'unanswered' })
  })
  it('adds up a session, counts unanswered, and splits by subject', () => {
    const qs = [q('1'), q('2'), q('3', { subjectId: 's2' }), q('4', { subjectId: 's2' })]
    const s = summarize(qs, { '1': { response: null, ms: 1, score: 1, outcome: 'correct' }, '2': { response: null, ms: 1, score: -0.25, outcome: 'incorrect' }, '3': { response: null, ms: 1, score: 0.5, outcome: 'partial' } })
    expect(s).toMatchObject({ score: 1.25, max: 4, correct: 1, incorrect: 1, partial: 1, unanswered: 1, percent: 31.3 })
    expect(s.bySubject).toEqual([
      { subjectId: 's1', correct: 1, partial: 0, incorrect: 1, unanswered: 0, total: 2, score: 0.75 },
      { subjectId: 's2', correct: 0, partial: 1, incorrect: 0, unanswered: 1, total: 2, score: 0.5 },
    ])
  })
  it('formats time', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(750_000)).toBe('12m 30s')
    expect(formatDuration(3_900_000)).toBe('1h 05m')
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
    expect(formatClock(-5)).toBe('00:00')
  })
})

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 9, 8, 0, ++t))
let server: FakeServer
beforeEach(() => { t = 0; server = fakeServer() })
const SBA: QuestionContent = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
const input = (subjectId: string, stem: string): QuestionInput => ({ subjectId, type: 'SBA', stem, difficulty: null, content: SBA, explanation: null, reference: null, topicIds: [] })
interface Device { store: WorkspaceStore; ws: WorkspaceRepo; q: QuestionRepo; s: SessionRepo; sync: () => ReturnType<typeof runWorkspaceSync> }
function device(): Device {
  const store = new WorkspaceStore(memoryBackend(), WORKSPACE_TABLES, clock)
  return { store, ws: localWorkspaceRepo(store), q: localQuestionRepo(store), s: localSessionRepo(store), sync: () => runWorkspaceSync(store, server) }
}
const rowsOf = (n: string) => [...(server.tables.get(n)?.values() ?? [])]
async function seed(d: Device, n = 3) {
  const subject = (await d.ws.createSubject('Anatomy', null)).data!
  const qs: WQuestion[] = []
  for (let i = 0; i < n; i++) qs.push((await d.q.create(input(subject.id, `Question ${i}?`))).data!)
  return { subject, qs }
}
const cfg = (over: Partial<SessionConfig> = {}): SessionConfig => ({ ...DEFAULT_CONFIG, ...over })

describe('session repo', () => {
  it('starts a session with its questions fixed, saves progress, and lists it', async () => {
    const d = device(); const { qs } = await seed(d)
    const s = (await d.s.start({ config: cfg({ count: 99 }), questions: qs, title: 'Practice: Anatomy' })).data!
    expect(s).toMatchObject({ kind: 'practice', status: 'in_progress', title: 'Practice: Anatomy', timeLimitSeconds: null })
    expect(s.questionIds).toEqual(qs.map((x) => x.id))
    expect(s.config.count).toBe(3) // the real number of questions, not what was asked for
    const state = { index: 1, answers: { [qs[0].id]: { response: { selected: 'a' }, ms: 1200, score: 1, outcome: 'correct' as const } } }
    const saved = (await d.s.saveProgress(s.id, state, 5000)).data!
    expect(saved).toMatchObject({ elapsedMs: 5000, state: { index: 1 } })
    expect((await d.s.list()).data).toHaveLength(1)
  })
  it('refuses an empty or oversize question list and a missing title', async () => {
    const d = device(); const { qs } = await seed(d)
    expect((await d.s.start({ config: cfg(), questions: [], title: 'x' })).error).toMatch(/no questions/)
    expect((await d.s.start({ config: cfg(), questions: qs, title: '  ' })).error).toMatch(/title/)
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `q${i}` }))
    expect((await d.s.start({ config: cfg(), questions: many, title: 'big' })).error).toMatch(/at most 500/)
  })
  it('an exam gets its time limit in seconds', async () => {
    const d = device(); const { qs } = await seed(d)
    const s = (await d.s.start({ config: cfg({ mode: 'exam', feedback: 'end', timeLimitMinutes: 90 }), questions: qs, title: 'Mock' })).data!
    expect(s).toMatchObject({ kind: 'exam', timeLimitSeconds: 5400 })
  })
  it('practice: records each answer, finishes with a result, and cannot be changed afterwards', async () => {
    const d = device(); const { qs } = await seed(d, 2)
    const s = (await d.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    const a1 = (await d.s.recordAttempt(s.id, { question: qs[0], response: { selected: 'a' }, score: 1, outcome: 'correct', timeMs: 3000 })).data!
    expect(a1).toMatchObject({ questionId: qs[0].id, questionVersion: 1, mode: 'practice', sessionId: s.id, outcome: 'correct' })
    const answers = { [qs[0].id]: { response: { selected: 'a' }, ms: 3000, score: 1, outcome: 'correct' as const } }
    const sum = summarize(qs, answers)
    const done = (await d.s.finish(s.id, { index: 1, answers }, 9000, sum, [])).data!
    expect(done).toMatchObject({ status: 'finished', result: { score: 1, max: 2, correct: 1, unanswered: 1 } })
    expect(done.finishedAt).toBeTruthy()
    expect((await d.s.saveProgress(s.id, { index: 0, answers: {} }, 1)).error).toMatch(/already ended/)
    expect((await d.s.recordAttempt(s.id, { question: qs[0], response: null, score: 0, outcome: 'unanswered', timeMs: 0 })).error).toMatch(/already ended/)
    expect((await d.s.finish(s.id, { index: 0, answers: {} }, 1, sum, [])).error).toMatch(/already ended/)
    expect((await d.s.attempts(s.id)).data).toHaveLength(1)
  })
  it('exam: submitting saves every answer, unanswered ones too, together with the result', async () => {
    const d = device(); const { qs } = await seed(d, 3)
    const s = (await d.s.start({ config: cfg({ mode: 'exam', feedback: 'end' }), questions: qs, title: 'Mock' })).data!
    const answers = {
      [qs[0].id]: { response: { selected: 'a' }, ms: 1000, score: 1, outcome: 'correct' as const },
      [qs[1].id]: { response: { selected: 'b' }, ms: 2000, score: -0.25, outcome: 'incorrect' as const },
    }
    const attempts = qs.map((x) => ({ question: x, response: answers[x.id as keyof typeof answers]?.response ?? null, score: answers[x.id as keyof typeof answers]?.score ?? 0, outcome: answers[x.id as keyof typeof answers]?.outcome ?? ('unanswered' as const), timeMs: answers[x.id as keyof typeof answers]?.ms ?? 0 }))
    const done = (await d.s.finish(s.id, { index: 2, answers }, 4000, summarize(qs, answers), attempts)).data!
    expect(done.result).toMatchObject({ score: 0.75, max: 3, correct: 1, incorrect: 1, unanswered: 1 })
    const saved = (await d.s.attempts(s.id)).data!
    expect(saved.map((a) => a.outcome).sort()).toEqual(['correct', 'incorrect', 'unanswered'])
    expect(saved.every((a) => a.mode === 'exam')).toBe(true)
  })
  it('abandon, rename and hide', async () => {
    const d = device(); const { qs } = await seed(d)
    const s = (await d.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    expect((await d.s.abandon(s.id, { index: 0, answers: {} }, 100)).data?.status).toBe('abandoned')
    expect((await d.s.rename(s.id, 'Renamed')).data?.title).toBe('Renamed')
    expect((await d.s.rename(s.id, '')).error).toMatch(/title/)
    await d.s.setHidden(s.id, true)
    expect((await d.s.list()).data).toEqual([])
    expect((await d.s.list({ includeHidden: true })).data).toHaveLength(1)
  })
  it('saved exams: create, unique name, rename, archive, remove; sessions keep their own settings', async () => {
    const d = device(); const { qs } = await seed(d)
    const e = (await d.s.createExam('  Mock 1 ', cfg({ mode: 'exam', timeLimitMinutes: 60 }))).data!
    expect(e).toMatchObject({ name: 'Mock 1', config: { mode: 'exam', timeLimitMinutes: 60 } })
    expect((await d.s.createExam('mock  1', cfg())).error).toMatch(/already have/)
    expect((await d.s.renameExam(e.id, 'Mock 2')).data?.name).toBe('Mock 2')
    expect((await d.s.setExamArchived(e.id, true)).data?.archived).toBe(true)
    const s = (await d.s.start({ config: e.config, questions: qs, title: 'Mock 2', examId: e.id })).data!
    await d.s.removeExam(e.id)
    expect((await d.s.listExams()).data).toEqual([])
    expect((await d.s.get(s.id)).data?.config.timeLimitMinutes).toBe(60)
  })
})

describe('session sync', () => {
  it('sends questions, then the session, then its answers, and a second device receives them', async () => {
    const a = device(); const { qs } = await seed(a, 2)
    const s = (await a.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    await a.s.recordAttempt(s.id, { question: qs[0], response: { selected: 'a' }, score: 1, outcome: 'correct', timeMs: 10 }) // the question has never been sent: stamped version 1
    const report = await a.sync()
    expect(report.errors).toEqual([])
    expect(rowsOf('user_sessions')).toHaveLength(1)
    expect(rowsOf('user_question_attempts')).toHaveLength(1)
    expect(rowsOf('user_question_attempts')[0]).toMatchObject({ question_version: 1, session_id: s.id, mode: 'practice', max_score: 1 })
    const b = device(); await b.sync()
    expect((await b.s.list()).data?.[0]).toMatchObject({ title: 'P', status: 'in_progress' })
    expect((await b.s.attempts(s.id)).data).toHaveLength(1)
  })
  it('a finished session reaches the server with its result, and hiding it afterwards still syncs', async () => {
    const a = device(); const { qs } = await seed(a, 1)
    const s = (await a.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    await a.s.finish(s.id, { index: 0, answers: {} }, 500, summarize(qs, {}), [])
    await a.sync()
    expect(rowsOf('user_sessions')[0]).toMatchObject({ status: 'finished', score: 0, max_score: 1, unanswered: 1 })
    await a.s.setHidden(s.id, true)
    const report = await a.sync()
    expect(report.errors).toEqual([])
    expect(rowsOf('user_sessions')[0].hidden_at).toBeTruthy()
  })
  it('a running session that finished on another device is not overwritten by an old copy', async () => {
    const a = device(); const { qs } = await seed(a, 1)
    const s = (await a.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    await a.sync()
    const b = device(); await b.sync()
    await a.s.finish(s.id, { index: 0, answers: {} }, 500, summarize(qs, {}), []); await a.sync()
    await b.s.saveProgress(s.id, { index: 0, answers: { x: { response: null, ms: 1 } } }, 900) // device B still believes it is running
    await b.sync()
    expect(rowsOf('user_sessions')[0]).toMatchObject({ status: 'finished', elapsed_ms: 500 })
  })
  it('an edited question gets its new version, and later answers are stamped with it', async () => {
    const a = device(); const { subject, qs } = await seed(a, 1)
    await a.sync()
    await a.q.update(qs[0].id, input(subject.id, 'Reworded?'))
    expect(eligibleForSession((await a.q.list()).data!).waiting).toBe(1) // waits until the edit is sent
    await a.sync()
    const fresh = (await a.q.list()).data![0]
    expect(fresh).toMatchObject({ version: 2, pendingEdit: false })
    const s = (await a.s.start({ config: cfg(), questions: [fresh], title: 'P' })).data!
    await a.s.recordAttempt(s.id, { question: fresh, response: { selected: 'a' }, score: 1, outcome: 'correct', timeMs: 5 })
    expect((await a.sync()).errors).toEqual([])
    expect(rowsOf('user_question_attempts')[0].question_version).toBe(2)
  })
  it('before migration M8 nothing breaks: sessions and answers wait on the device, other tables still sync, then all is sent', async () => {
    for (const n of ['user_exams', 'user_sessions', 'user_question_attempts']) server.missingTables.add(n)
    const a = device(); const { qs } = await seed(a, 1)
    const s = (await a.s.start({ config: cfg(), questions: qs, title: 'P' })).data!
    await a.s.recordAttempt(s.id, { question: qs[0], response: { selected: 'a' }, score: 1, outcome: 'correct', timeMs: 5 })
    const report = await a.sync()
    expect(report.errors).toEqual([])
    expect(rowsOf('user_questions')).toHaveLength(1)
    expect(rowsOf('user_sessions')).toHaveLength(0)
    server.missingTables.clear()
    expect((await a.sync()).errors).toEqual([])
    expect(rowsOf('user_sessions')).toHaveLength(1)
    expect(rowsOf('user_question_attempts')).toHaveLength(1)
  })
  it('removing a saved exam on one device leaves the session on the other with no exam', async () => {
    const a = device(); const { qs } = await seed(a, 1)
    const e = (await a.s.createExam('Mock', cfg({ mode: 'exam' }))).data!
    await a.s.start({ config: e.config, questions: qs, title: 'Mock', examId: e.id })
    await a.sync()
    await a.s.removeExam(e.id)
    expect((await a.sync()).errors).toEqual([])
    expect(rowsOf('user_exams')).toHaveLength(0)
    expect(rowsOf('user_sessions')[0].exam_id).toBeNull()
  })
})
