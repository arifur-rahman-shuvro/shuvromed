import { describe, expect, it } from 'vitest'
import { BADGES, XP_RULES, buildProgress, levelInfo, longestStreak, xpFor, xpForLevel } from '../gamification/progress'
import type { Attempt } from '../practice/attempts'

let n = 0
const at = (day: string, over: Partial<Attempt> = {}): Attempt => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, questionId: `q${n}`, selectedOptionId: 'A', isCorrect: true, timeMs: 1000,
  mode: 'practice', attemptedAt: `${day}T10:00:${String(n % 60).padStart(2, '0')}.000Z`, contentVersion: 'v', ...over,
})
const many = (k: number, day: string, over: Partial<Attempt> = {}) => Array.from({ length: k }, () => at(day, over))
const days = (...d: string[]) => new Set(d)

describe('XP', () => {
  it('pays practice and mock answers by the published rules', () => {
    expect(xpFor([at('2026-11-02')])).toBe(XP_RULES.practiceCorrect)
    expect(xpFor([at('2026-11-02', { isCorrect: false })])).toBe(XP_RULES.practiceWrong)
    expect(xpFor([at('2026-11-02', { mode: 'mock' })])).toBe(XP_RULES.mockCorrect)
    expect(xpFor([at('2026-11-02', { mode: 'mock', isCorrect: false })])).toBe(XP_RULES.mockWrong)
    expect(xpFor([at('2026-11-02', { mode: 'revision' })])).toBe(XP_RULES.practiceCorrect)
    expect(xpFor([])).toBe(0)
  })
  it('only the first answer to a question each day counts (no farming), but a new day counts again', () => {
    const a = at('2026-11-02', { questionId: 'same', isCorrect: false })
    const b = at('2026-11-02', { questionId: 'same', isCorrect: true, attemptedAt: '2026-11-02T11:00:00.000Z' })
    expect(xpFor([b, a])).toBe(XP_RULES.practiceWrong) // order of the array does not matter
    const next = at('2026-11-03', { questionId: 'same' })
    expect(xpFor([a, b, next])).toBe(XP_RULES.practiceWrong + XP_RULES.practiceCorrect)
  })
  it('is identical for the same history on any device (order independent, no state)', () => {
    const h = [...many(7, '2026-11-02'), ...many(3, '2026-11-03', { isCorrect: false })]
    expect(xpFor([...h].reverse())).toBe(xpFor(h))
  })
})

describe('levels', () => {
  it('thresholds are 0, 100, 300, 600, 1000', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000])
  })
  it('finds the level and progress inside it', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, into: 0, span: 100 })
    expect(levelInfo(99)).toMatchObject({ level: 1, into: 99 })
    expect(levelInfo(100)).toMatchObject({ level: 2, into: 0, span: 200 })
    expect(levelInfo(599)).toMatchObject({ level: 3, into: 299, span: 300 })
    expect(levelInfo(600).level).toBe(4)
  })
})

describe('streaks', () => {
  it('longest streak finds the best run, ignores gaps and handles month ends', () => {
    expect(longestStreak(days())).toBe(0)
    expect(longestStreak(days('2026-11-01'))).toBe(1)
    expect(longestStreak(days('2026-10-30', '2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06'))).toBe(3)
  })
  it('current streak is alive until a whole day is missed', () => {
    const h = [at('2026-11-05'), at('2026-11-06'), at('2026-11-07')].map((a) => ({ ...a, attemptedAt: a.attemptedAt.replace('T10', 'T08') }))
    expect(buildProgress(h, '2026-11-07').streakDays).toBe(3)
    expect(buildProgress(h, '2026-11-08').streakDays).toBe(3) // today not over yet
    expect(buildProgress(h, '2026-11-09').streakDays).toBe(0)
    expect(buildProgress(h, '2026-11-09').longestStreakDays).toBe(3)
  })
})

describe('badges', () => {
  const earned = (h: Attempt[], today = '2026-12-31') => Object.fromEntries(buildProgress(h, today).badges.map((b) => [b.id, b.earnedAt]))
  it('has a unique id and a how-to for every badge', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length)
    for (const b of BADGES) expect(b.how.length).toBeGreaterThan(5)
    expect(Object.keys(earned([])).length).toBe(BADGES.length)
  })
  it('nothing is earned with no answers', () => {
    expect(Object.values(earned([])).every((v) => v === null)).toBe(true)
  })
  it('answer-count badges unlock at exactly the Nth answer and carry its time', () => {
    const h = many(10, '2026-11-02')
    const e = earned(h)
    expect(e['first-answer']).toBe(h[0].attemptedAt)
    expect(e['answers-10']).toBe(h[9].attemptedAt)
    expect(e['answers-100']).toBeNull()
    expect(earned(many(9, '2026-11-02'))['answers-10']).toBeNull()
  })
  it('streak badges need that many consecutive days', () => {
    const e = earned([at('2026-11-02'), at('2026-11-03'), at('2026-11-05')])
    expect(e['streak-3']).toBeNull()
    expect(earned([at('2026-11-02'), at('2026-11-03'), at('2026-11-04')])['streak-3']).not.toBeNull()
    expect(earned(Array.from({ length: 7 }, (_, i) => at(`2026-11-0${i + 1}`)))['streak-7']).not.toBeNull()
  })
  it('mock and revision badges count only those modes', () => {
    const e = earned([...many(49, '2026-11-02', { mode: 'mock' }), ...many(9, '2026-11-02', { mode: 'revision' })])
    expect(e['mock-first']).not.toBeNull()
    expect(e['mock-50']).toBeNull()
    expect(e['revision-10']).toBeNull()
    const f = earned([...many(50, '2026-11-02', { mode: 'mock' }), ...many(10, '2026-11-02', { mode: 'revision' })])
    expect(f['mock-50']).not.toBeNull()
    expect(f['revision-10']).not.toBeNull()
  })
  it('accuracy badge needs 50 answers at 80%, and stays earned afterwards', () => {
    expect(earned(many(49, '2026-11-02'))['accuracy-80']).toBeNull() // too few answers
    const good = [...many(40, '2026-11-02'), ...many(10, '2026-11-02', { isCorrect: false })] // exactly 80%
    expect(earned(good)['accuracy-80']).not.toBeNull()
    const poor = [...many(39, '2026-11-02'), ...many(11, '2026-11-02', { isCorrect: false })]
    expect(earned(poor)['accuracy-80']).toBeNull()
    const slump = [...good, ...many(60, '2026-11-03', { isCorrect: false })]
    expect(earned(slump)['accuracy-80']).not.toBeNull()
  })
})
