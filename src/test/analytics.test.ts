import { describe, expect, it } from 'vitest'
import { MIN_ANSWERS_FOR_WEAK, TREND_DAYS, buildAnalytics } from '../analytics/analytics'
import type { Attempt } from '../practice/attempts'
import type { MockResult } from '../mock/mock'
import { realContent } from './content'

const c = realContent()
const questions = c.questions
const topics = c.topics
const subjects = c.subjects
const TODAY = '2026-11-07'
let n = 0
const at = (questionId: string, isCorrect: boolean, over: Partial<Attempt> = {}): Attempt => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, questionId, selectedOptionId: 'A', isCorrect, timeMs: 30_000, mode: 'practice',
  attemptedAt: new Date(2026, 10, 7, 9, n % 50).toISOString(), contentVersion: 'v', ...over,
})
const run = (a: Attempt[], mocks: MockResult[] = []) => buildAnalytics(a, questions, topics, subjects, mocks, TODAY)
const COR = 'anatomy-coronary-arteries'

describe('buildAnalytics', () => {
  it('is empty and honest with no answers', () => {
    const a = run([])
    expect(a).toMatchObject({ answers: 0, accuracyPct: null, avgSeconds: null, weakTopics: [], orphanedAnswers: 0, mocks: [] })
    expect(a.days).toHaveLength(TREND_DAYS)
    expect(a.days.every((d) => d.answered === 0)).toBe(true)
  })

  it('overall figures: answers, accuracy, distinct questions, average time', () => {
    const a = run([at('demo-anat-cor-001', true), at('demo-anat-cor-001', false, { timeMs: 90_000 }), at('demo-phys-cycle-001', true)])
    expect(a).toMatchObject({ answers: 3, distinctQuestions: 2 })
    expect(a.accuracyPct).toBeCloseTo(66.67, 1)
    expect(a.avgSeconds).toBeCloseTo(50, 5)
  })

  it('a topic is weak only with enough answers AND accuracy below 70%', () => {
    const few = run([at('demo-anat-cor-001', false), at('demo-anat-cor-002', false)]) // 2 answers < minimum
    expect(MIN_ANSWERS_FOR_WEAK).toBe(3)
    expect(few.weakTopics).toEqual([])
    expect(few.tooFewTopics).toBe(1)
    const weak = run([at('demo-anat-cor-001', false), at('demo-anat-cor-002', false), at('demo-anat-cor-003', true)])
    expect(weak.weakTopics.map((t) => t.id)).toEqual([COR])
    expect(weak.weakTopics[0].accuracyPct).toBeCloseTo(33.33, 1)
    const strong = run([at('demo-anat-cor-001', true), at('demo-anat-cor-002', true), at('demo-anat-cor-003', false)]) // 66.7% still weak
    expect(strong.weakTopics).toHaveLength(1)
    const fine = run([at('demo-anat-cor-001', true), at('demo-anat-cor-002', true), at('demo-anat-cor-003', true), at('demo-anat-cor-003', false)]) // 75%
    expect(fine.weakTopics).toEqual([])
  })

  it('weakest topic is listed first', () => {
    const a = run([
      ...['demo-anat-cor-001', 'demo-anat-cor-002', 'demo-anat-cor-003'].map((q) => at(q, false)), // 0%
      at('demo-phys-cycle-001', true), at('demo-phys-cycle-002', false), at('demo-phys-cycle-002', false), // 33%
    ])
    expect(a.weakTopics.map((t) => t.id)).toEqual([COR, 'physiology-cardiac-cycle'])
  })

  it('mastery counts only the latest answer per question; unanswered questions count as not mastered', () => {
    const a = run([
      at('demo-anat-cor-001', false, { attemptedAt: '2026-11-07T01:00:00.000Z' }),
      at('demo-anat-cor-001', true, { attemptedAt: '2026-11-07T02:00:00.000Z' }),
    ])
    const t = a.topics.find((x) => x.id === COR)!
    expect(t.questionCount).toBe(3)
    expect(t.masteryPct).toBeCloseTo(33.33, 1)
    expect(t.attemptedQuestions).toBe(1)
  })

  it('answers for questions that are no longer in the bank are excluded and counted', () => {
    const a = run([at('demo-anat-cor-001', true), at('deleted-question', false)])
    expect(a).toMatchObject({ answers: 1, orphanedAnswers: 1 })
    expect(a.accuracyPct).toBe(100)
  })

  it('difficulty and confidence breakdowns, with sure-but-wrong counted', () => {
    const a = run([
      at('demo-anat-cor-001', true, { confidence: 5 }), // easy
      at('demo-anat-cor-002', false, { confidence: 5 }), // medium, sure but wrong
      at('demo-anat-cor-003', true, { confidence: 1 }), // medium, unsure but right
      at('demo-phys-cycle-001', false), // unrated
    ])
    expect(a.difficulty.find((d) => d.difficulty === 'easy')).toMatchObject({ answers: 1, accuracyPct: 100 })
    expect(a.difficulty.find((d) => d.difficulty === 'medium')).toMatchObject({ answers: 3 })
    expect(a.difficulty.find((d) => d.difficulty === 'hard')).toMatchObject({ answers: 0, accuracyPct: null })
    expect(a.ratedAnswers).toBe(3)
    expect(a.sureButWrong).toBe(1)
    expect(a.unsureButRight).toBe(1)
    expect(a.confidence.find((r) => r.rating === 5)).toMatchObject({ answers: 2, accuracyPct: 50 })
    expect(a.confidence.find((r) => r.rating === 3)).toMatchObject({ answers: 0, accuracyPct: null })
  })

  it('daily trend covers exactly the last 14 days ending today, oldest first, with zero-filled gaps', () => {
    const a = run([at('demo-anat-cor-001', true), at('demo-anat-cor-002', false)])
    expect(a.days).toHaveLength(TREND_DAYS)
    expect(a.days[TREND_DAYS - 1]).toEqual({ date: TODAY, answered: 2, correct: 1 })
    expect(a.days[0].date).toBe('2026-10-25')
    expect(a.days.slice(0, -1).every((d) => d.answered === 0)).toBe(true)
  })

  it('average time per mode', () => {
    const a = run([at('demo-anat-cor-001', true, { mode: 'mock', timeMs: 10_000 }), at('demo-anat-cor-002', true, { mode: 'mock', timeMs: 20_000 }), at('demo-anat-cor-003', true, { mode: 'revision', timeMs: 5_000 })])
    expect(a.avgSecondsByMode.find((m) => m.mode === 'mock')).toMatchObject({ answers: 2, avgSeconds: 15 })
    expect(a.avgSecondsByMode.find((m) => m.mode === 'practice')).toMatchObject({ answers: 0, avgSeconds: null })
  })

  it('keeps the last 10 mock results, oldest first, scoring unanswered as wrong', () => {
    const mk = (i: number, correct: number): MockResult => ({
      id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}`, seed: 's', config: { subjectId: null, topicId: null, examStyle: null, count: 4, secondsPerQuestion: 90 },
      questionIds: ['a', 'b', 'c', 'd'], answers: {}, flagged: [], startedAt: `2026-11-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`, finishedAt: `2026-11-${String(i + 1).padStart(2, '0')}T08:30:00.000Z`,
      total: 4, answered: 4, correct, timedOut: false,
    })
    const results = Array.from({ length: 12 }, (_, i) => mk(i, i % 5))
    const a = run([], [...results].reverse())
    expect(a.mocks).toHaveLength(10)
    expect(a.mocks[0].finishedAt < a.mocks[9].finishedAt).toBe(true)
    expect(a.mocks[9].scorePct).toBe(((11 % 5) / 4) * 100)
  })
})
