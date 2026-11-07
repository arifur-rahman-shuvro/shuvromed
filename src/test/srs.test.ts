import { describe, expect, it } from 'vitest'
import type { Attempt } from '../practice/attempts'
import { applyAttempt, buildSchedule, dueQuestions, MAX_INTERVAL_DAYS, MIN_EASE } from '../practice/srs'

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 10, day, hour)).toISOString()
const att = (q: string, isCorrect: boolean, when: string, confidence?: number): Attempt => ({
  id: id(), questionId: q, selectedOptionId: 'A', isCorrect, timeMs: 1000, mode: 'practice', attemptedAt: when, contentVersion: 'v', ...(confidence ? { confidence } : {}),
})
const days = (s: { dueAt: string; lastReviewedAt: string }) => (Date.parse(s.dueAt) - Date.parse(s.lastReviewedAt)) / 86_400_000

describe('spaced repetition', () => {
  it('first correct answer is due in 1 day, then 3, then interval x ease', () => {
    const s1 = applyAttempt(null, att('q', true, at(1)))
    expect(s1.intervalDays).toBe(1)
    const s2 = applyAttempt(s1, att('q', true, at(2)))
    expect(s2.intervalDays).toBe(3)
    const s3 = applyAttempt(s2, att('q', true, at(5)))
    expect(s3.intervalDays).toBe(7.5)
    expect(days(s3)).toBe(7.5)
    expect(s3.repetitions).toBe(3)
  })
  it('a wrong answer resets to 1 day, counts a lapse and lowers ease', () => {
    const s1 = applyAttempt(applyAttempt(null, att('q', true, at(1))), att('q', true, at(2)))
    const s2 = applyAttempt(s1, att('q', false, at(5)))
    expect(s2).toMatchObject({ intervalDays: 1, repetitions: 0, lapses: 1, ease: 2.3 })
  })
  it('ease never drops below the floor and the interval never exceeds the cap', () => {
    let s = applyAttempt(null, att('q', false, at(1)))
    for (let i = 0; i < 20; i++) s = applyAttempt(s, att('q', false, at(1)))
    expect(s.ease).toBe(MIN_EASE)
    let g = applyAttempt(null, att('q', true, at(1), 5))
    for (let i = 0; i < 40; i++) g = applyAttempt(g, att('q', true, at(1), 5))
    expect(g.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
  })
  it('low confidence on a right answer grows the interval more slowly than high confidence', () => {
    const guess = applyAttempt(applyAttempt(null, att('q', true, at(1), 1)), att('q', true, at(2), 1))
    const sure = applyAttempt(applyAttempt(null, att('q', true, at(1), 5)), att('q', true, at(2), 5))
    expect(guess.intervalDays).toBeLessThan(sure.intervalDays)
    expect(guess.ease).toBeLessThan(sure.ease)
  })
  it('buildSchedule replays in time order regardless of input order, so devices agree', () => {
    const list = [att('q', true, at(1)), att('q', false, at(3)), att('q', true, at(4)), att('r', true, at(2))]
    const a = buildSchedule(list)
    const b = buildSchedule([...list].reverse())
    expect([...a.entries()]).toEqual([...b.entries()])
    expect(a.get('q')).toMatchObject({ lapses: 1, repetitions: 1 })
  })
  it('dueQuestions returns only overdue ones, most overdue first', () => {
    const sched = buildSchedule([att('late', true, at(1)), att('later', true, at(3)), att('far', true, at(20))])
    const due = dueQuestions(sched, new Date(Date.UTC(2026, 10, 5, 10)))
    expect(due.map((d) => d.questionId)).toEqual(['late', 'later'])
    expect(dueQuestions(sched, new Date(Date.UTC(2026, 10, 1, 10)))).toEqual([])
  })
})
