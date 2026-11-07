import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MOCK, buildMock, clampMockCount, finishRun, goTo, remainingMs, scorePct, setAnswer, startRun, summarizeResult, toggleFlag, totalSeconds, unansweredCount, type MockConfig } from '../mock/mock'
import { MAX_RESULTS, completeActive, discardActive, loadMock, resetMockCache, saveActive } from '../mock/store'
import { realContent } from './content'

const c = realContent()
const topics = c.topics
const pool = c.questions
const cfg = (over: Partial<MockConfig> = {}): MockConfig => ({ ...DEFAULT_MOCK, count: 5, ...over })
const ID = '11111111-1111-4111-8111-111111111111'
const T0 = new Date('2026-11-07T08:00:00.000Z')
let n = 0
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const wrongOf = (qid: string) => pool.find((q) => q.id === qid)!.options.find((o) => o.id !== pool.find((q) => q.id === qid)!.correctOptionId)!.id

describe('buildMock', () => {
  it('is deterministic for a seed and different for another', () => {
    const a = buildMock(pool, topics, cfg({ count: 8 }), 's1').map((q) => q.id)
    expect(buildMock(pool, topics, cfg({ count: 8 }), 's1').map((q) => q.id)).toEqual(a)
    expect(buildMock(pool, topics, cfg({ count: 8 }), 'another-seed').map((q) => q.id).sort()).toEqual([...a].sort())
  })
  it('filters by subject and topic, caps at the requested count and at what exists', () => {
    expect(buildMock(pool, topics, cfg({ subjectId: 'anatomy', count: 100 }), 's').every((q) => q.subjectId === 'anatomy')).toBe(true)
    expect(buildMock(pool, topics, cfg({ subjectId: 'anatomy', count: 100 }), 's')).toHaveLength(4)
    expect(buildMock(pool, topics, cfg({ count: 3 }), 's')).toHaveLength(3)
    expect(buildMock(pool, topics, cfg({ subjectId: 'anatomy', topicId: 'anatomy-coronary-arteries', count: 50 }), 's').every((q) => q.topicId === 'anatomy-coronary-arteries')).toBe(true)
    expect(buildMock(pool, topics, cfg({ subjectId: 'no-such-subject' }), 's')).toEqual([])
  })
  it('never repeats a question', () => {
    const ids = buildMock(pool, topics, cfg({ count: 100 }), 's').map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('clamps silly counts', () => {
    expect([clampMockCount(0), clampMockCount(-4), clampMockCount(1000), clampMockCount(NaN), clampMockCount(7.6)]).toEqual([1, 1, 100, 20, 8])
  })
})

describe('running an exam', () => {
  const qs = () => buildMock(pool, topics, cfg(), 'seed')
  it('sets one deadline for the whole exam from the pace and the real question count', () => {
    const run = startRun(qs(), cfg({ count: 99, secondsPerQuestion: 60 }), 'seed', ID, T0, 'v1')
    expect(run.config.count).toBe(5)
    expect(totalSeconds(run.config)).toBe(300)
    expect(remainingMs(run, T0)).toBe(300_000)
    expect(remainingMs(run, new Date(T0.getTime() + 100_000))).toBe(200_000)
    expect(remainingMs(run, new Date(T0.getTime() + 999_000))).toBe(0)
  })
  it('answers can be changed, cleared by choosing again, and unknown questions are ignored', () => {
    let run = startRun(qs(), cfg(), 'seed', ID, T0, 'v1')
    const q = run.questionIds[0]
    run = setAnswer(run, q, 'A')
    run = setAnswer(run, q, 'B')
    expect(run.answers[q]).toBe('B')
    run = setAnswer(run, q, 'B')
    expect(run.answers[q]).toBeUndefined()
    expect(setAnswer(run, 'not-in-exam', 'A')).toBe(run)
    expect(unansweredCount(setAnswer(run, q, 'C'))).toBe(4)
  })
  it('flags toggle', () => {
    let run = startRun(qs(), cfg(), 'seed', ID, T0, 'v1')
    const q = run.questionIds[1]
    run = toggleFlag(run, q)
    expect(run.flagged).toEqual([q])
    expect(toggleFlag(run, q).flagged).toEqual([])
    expect(toggleFlag(run, 'x')).toBe(run)
  })
  it('moving between questions adds the time spent on the one you leave, and stays in range', () => {
    let run = startRun(qs(), cfg(), 'seed', ID, T0, 'v1')
    const first = run.questionIds[0]
    run = goTo(run, 2, 4000)
    expect(run).toMatchObject({ current: 2, spentMs: { [first]: 4000 } })
    run = goTo(goTo(run, 0, 1500), 99)
    expect(run.current).toBe(4)
    expect(goTo(run, -5).current).toBe(0)
    expect(run.spentMs[first]).toBe(4000)
  })
})

describe('finishing and scoring', () => {
  it('records one mock attempt per answered question; unanswered count as wrong; correctness is judged on the original option', () => {
    const questions = buildMock(pool, topics, cfg({ count: 5 }), 'seed')
    let run = startRun(questions, cfg(), 'seed', ID, T0, 'v9')
    const [a, b, c2] = run.questionIds
    run = setAnswer(run, a, pool.find((q) => q.id === a)!.correctOptionId)
    run = setAnswer(run, b, wrongOf(b))
    run = setAnswer(run, c2, pool.find((q) => q.id === c2)!.correctOptionId)
    run = toggleFlag(run, b)
    const done = finishRun(run, questions, new Date(T0.getTime() + 60_000), false, newId)
    expect(done.attempts).toHaveLength(3)
    expect(done.attempts.every((x) => x.mode === 'mock' && x.contentVersion === 'v9')).toBe(true)
    expect(done.attempts.map((x) => x.isCorrect)).toEqual([true, false, true])
    expect(done.result).toMatchObject({ id: ID, total: 5, answered: 3, correct: 2, timedOut: false, flagged: [b] })
    expect(scorePct(done.result)).toBe(40)
    expect(new Set(done.attempts.map((x) => x.id)).size).toBe(3)
    // times strictly ordered and not in the future
    const times = done.attempts.map((x) => x.attemptedAt)
    expect([...times].sort()).toEqual(times)
    expect(Date.parse(times[2])).toBeLessThanOrEqual(T0.getTime() + 60_000)
  })
  it('an exam with no answers is valid: score 0, nothing recorded', () => {
    const questions = buildMock(pool, topics, cfg(), 'seed')
    const done = finishRun(startRun(questions, cfg(), 'seed', ID, T0, 'v'), questions, new Date(T0.getTime() + 1000), true, newId)
    expect(done.attempts).toEqual([])
    expect(done.result).toMatchObject({ answered: 0, correct: 0, total: 5, timedOut: true })
  })
  it('summary counts unanswered as skipped and groups by topic', () => {
    const questions = buildMock(pool, topics, cfg({ count: 4, subjectId: 'anatomy' }), 'seed')
    let run = startRun(questions, cfg({ count: 4 }), 'seed', ID, T0, 'v')
    run = setAnswer(run, run.questionIds[0], pool.find((q) => q.id === run.questionIds[0])!.correctOptionId)
    const { result } = finishRun(run, questions, T0, false, newId)
    const s = summarizeResult(result, pool)
    expect(s).toMatchObject({ total: 4, answered: 1, correct: 1, skipped: 3 })
    expect(Object.values(s.byTopic).reduce((x, g) => x + g.answered, 0)).toBe(1)
  })
})

describe('mock storage', () => {
  beforeEach(() => { localStorage.clear(); resetMockCache() })
  const U = 'u1'
  const sample = () => {
    const questions = buildMock(pool, topics, cfg(), 'seed')
    const run = startRun(questions, cfg(), 'seed', ID, T0, 'v')
    return { run, ...finishRun(run, questions, T0, false, newId) }
  }
  it('keeps the exam in progress across a reload (new cache) and clears it on completion', () => {
    const { run, result } = sample()
    expect(saveActive(U, run).ok).toBe(true)
    resetMockCache()
    expect(loadMock(U).active).toEqual(run)
    expect(completeActive(U, result).ok).toBe(true)
    resetMockCache()
    expect(loadMock(U)).toEqual({ active: null, results: [result] })
  })
  it('discard removes the exam in progress only', () => {
    const { run, result } = sample()
    completeActive(U, result)
    saveActive(U, { ...run, id: '22222222-2222-4222-8222-222222222222' })
    discardActive(U)
    expect(loadMock(U)).toEqual({ active: null, results: [result] })
  })
  it('keeps at most 30 results, newest first, replacing a repeated id', () => {
    const { result } = sample()
    for (let i = 0; i < 35; i++) completeActive(U, { ...result, id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}` })
    expect(loadMock(U).results).toHaveLength(MAX_RESULTS)
    expect(loadMock(U).results[0].id).toBe('00000000-0000-4000-8000-000000000934')
    completeActive(U, { ...result, id: '00000000-0000-4000-8000-000000000934', correct: 0 })
    expect(loadMock(U).results).toHaveLength(MAX_RESULTS)
  })
  it('survives corrupt storage: bad entries are dropped, good ones kept; accounts are separate', () => {
    const { result } = sample()
    localStorage.setItem('shuvromed.mock.v1.u1', JSON.stringify({ active: { nonsense: 1 }, results: [result, { bad: true }] }))
    resetMockCache()
    expect(loadMock('u1')).toEqual({ active: null, results: [result] })
    localStorage.setItem('shuvromed.mock.v1.u2', '{not json')
    resetMockCache()
    expect(loadMock('u2')).toEqual({ active: null, results: [] })
    expect(loadMock('u3')).toEqual({ active: null, results: [] })
  })
})
