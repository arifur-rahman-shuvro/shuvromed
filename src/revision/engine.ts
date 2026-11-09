import type { WAttempt } from '../session/repo'

const DAY = 86400000
/** Days to wait after 0, 1, 2 ... good answers in a row. A wrong answer goes back to the start. */
export const INTERVAL_DAYS = [1, 2, 4, 8, 16, 32, 60] as const

export interface QStat {
  questionId: string
  /** Answers that count (an exam question left blank is not an answer). */
  answers: number
  wrong: number
  /** Right answers. A partly right answer counts as half in accuracy. */
  correct: number
  lastAt: string
  lastOutcome: 'correct' | 'partial' | 'incorrect'
  /** Good answers in a row, from the oldest to the latest, reset by a wrong one. */
  step: number
  dueAt: string
  /** Said 4 or 5 (sure) and was wrong. */
  overconfident: number
}

const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * DAY).toISOString()
const credit = (o: string) => (o === 'correct' ? 1 : o === 'partial' ? 0.5 : 0)

/**
 * Works out, for every question that has been answered, when it should come back. Nothing is stored: it is recomputed from
 * the answers, so it is always consistent with them. A right answer given as a guess (confidence 1) does not move the question forward.
 */
export function buildStats(attempts: WAttempt[]): Map<string, QStat> {
  const out = new Map<string, QStat>()
  const sorted = [...attempts].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt))
  for (const a of sorted) {
    if (a.outcome === 'unanswered') continue
    const s = out.get(a.questionId) ?? { questionId: a.questionId, answers: 0, wrong: 0, correct: 0, lastAt: a.attemptedAt, lastOutcome: 'correct' as const, step: 0, dueAt: a.attemptedAt, overconfident: 0 }
    s.answers++
    s.correct += credit(a.outcome)
    if (a.outcome === 'incorrect') { s.wrong++; s.step = 0; if ((a.confidence ?? 0) >= 4) s.overconfident++ }
    else if (a.outcome === 'correct' && a.confidence !== 1) s.step = Math.min(INTERVAL_DAYS.length - 1, s.step + 1)
    s.lastAt = a.attemptedAt
    s.lastOutcome = a.outcome
    s.dueAt = addDays(a.attemptedAt, INTERVAL_DAYS[s.step === 0 ? 0 : s.step - 1] ?? 1)
    out.set(a.questionId, s)
  }
  return out
}

/** Questions whose time has come, the most overdue first. Questions never answered are not "due". */
export function dueList(stats: Map<string, QStat>, now: Date, allowed?: Set<string>): QStat[] {
  const t = now.getTime()
  return [...stats.values()]
    .filter((s) => (!allowed || allowed.has(s.questionId)) && new Date(s.dueAt).getTime() <= t)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || b.wrong - a.wrong)
}

/** Questions answered wrongly at least twice, and wrong at least half of the time. */
export function oftenWrong(stats: Map<string, QStat>, allowed?: Set<string>): QStat[] {
  return [...stats.values()]
    .filter((s) => (!allowed || allowed.has(s.questionId)) && s.wrong >= 2 && s.wrong / s.answers >= 0.5)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.answers - a.wrong / a.answers)
}
