import { describe, expect, it } from 'vitest'
import { byVersion, confidenceCalibration, totals, weakGroups, weeklyTrend } from '../revision/analytics'
import { buildStats, dueList, oftenWrong } from '../revision/engine'
import type { WAttempt } from '../session/repo'

let n = 0
const at = (q: string, outcome: WAttempt['outcome'], day: number, over: Partial<WAttempt> = {}): WAttempt => ({
  id: `a${++n}`, questionId: q, questionVersion: 1, response: null, score: outcome === 'correct' ? 1 : 0, outcome, timeMs: 10000, mode: 'practice', confidence: null, sessionId: null,
  attemptedAt: new Date(Date.UTC(2026, 10, day, 8)).toISOString(), ...over,
})
const NOW = new Date(Date.UTC(2026, 10, 20, 8))

describe('revision schedule', () => {
  it('moves a question further out after each right answer and back after a wrong one', () => {
    const s = buildStats([at('q', 'correct', 1), at('q', 'correct', 2), at('q', 'correct', 4)]).get('q')!
    expect(s.step).toBe(3)
    expect(s.dueAt).toBe(new Date(Date.UTC(2026, 10, 8, 8)).toISOString()) // 4 days after the 3rd good answer (day 4)
    const w = buildStats([at('q', 'correct', 1), at('q', 'correct', 2), at('q', 'incorrect', 3)]).get('q')!
    expect(w.step).toBe(0)
    expect(w.dueAt).toBe(new Date(Date.UTC(2026, 10, 4, 8)).toISOString())
  })
  it('does not count a right answer given as a guess, nor an unanswered one', () => {
    const s = buildStats([at('q', 'correct', 1, { confidence: 1 }), at('q', 'unanswered', 2)]).get('q')!
    expect(s.step).toBe(0)
    expect(s.answers).toBe(1)
  })
  it('lists only due, allowed questions, most overdue first', () => {
    const stats = buildStats([at('old', 'incorrect', 1), at('new', 'incorrect', 18), at('fresh', 'incorrect', 20), at('hidden', 'incorrect', 2)])
    expect(dueList(stats, NOW, new Set(['old', 'new', 'fresh'])).map((d) => d.questionId)).toEqual(['old', 'new'])
  })
  it('finds questions wrong at least twice and at least half the time', () => {
    const stats = buildStats([at('a', 'incorrect', 1), at('a', 'incorrect', 2), at('b', 'incorrect', 1), at('c', 'incorrect', 1), at('c', 'incorrect', 2), at('c', 'correct', 3), at('c', 'correct', 4), at('c', 'correct', 5)])
    expect(oftenWrong(stats).map((s) => s.questionId)).toEqual(['a'])
  })
  it('counts how often you were sure and wrong', () => {
    expect(buildStats([at('q', 'incorrect', 1, { confidence: 5 }), at('q', 'incorrect', 2, { confidence: 2 })]).get('q')!.overconfident).toBe(1)
  })
})

describe('analytics', () => {
  it('totals count partial as half and ignore unanswered', () => {
    const t = totals([at('q', 'correct', 1), at('q', 'partial', 1), at('q', 'incorrect', 2), at('q', 'unanswered', 2)])
    expect(t).toMatchObject({ answers: 3, accuracyPct: 50, avgSeconds: 10, days: 2 })
  })
  it('ranks weak groups, weakest first, only with enough answers', () => {
    const list = [...Array(5)].map((_, i) => at('a', i < 1 ? 'correct' : 'incorrect', 1)).concat([...Array(5)].map(() => at('b', 'correct', 1)), [at('c', 'incorrect', 1)])
    const g = weakGroups(list, (id) => [id.toUpperCase()])
    expect(g.map((x) => [x.key, x.accuracyPct])).toEqual([['A', 20], ['B', 100]])
  })
  it('compares confidence with results', () => {
    const c = confidenceCalibration([at('q', 'correct', 1, { confidence: 5 }), at('q', 'incorrect', 1, { confidence: 5 }), at('q', 'correct', 1)])
    expect(c.rated).toBe(2)
    expect(c.sureButWrong).toBe(1)
    expect(c.rows[4]).toMatchObject({ answers: 2, accuracyPct: 50 })
  })
  it('builds 8 weekly rows including empty weeks', () => {
    const w = weeklyTrend([at('q', 'correct', 18)], NOW)
    expect(w).toHaveLength(8)
    expect(w[7]).toMatchObject({ answers: 1, accuracyPct: 100 })
    expect(w[0].answers).toBe(0)
  })
  it('splits one question by the version answered', () => {
    const r = byVersion([at('q', 'correct', 1), at('q', 'incorrect', 2, { questionVersion: 2 }), at('x', 'correct', 2)], 'q')
    expect(r.map((x) => [x.version, x.answers, x.incorrect])).toEqual([[2, 1, 1], [1, 1, 0]])
  })
})
