import type { WAttempt } from '../session/repo'

const credit = (o: string) => (o === 'correct' ? 1 : o === 'partial' ? 0.5 : 0)
const pct = (n: number, d: number): number | null => (d ? Math.round((n / d) * 1000) / 10 : null)
const counted = (a: WAttempt[]) => a.filter((x) => x.outcome !== 'unanswered')

export interface Totals { answers: number; accuracyPct: number | null; avgSeconds: number | null; days: number }
export function totals(attempts: WAttempt[]): Totals {
  const c = counted(attempts)
  const timed = c.filter((a) => a.timeMs > 0)
  return {
    answers: c.length,
    accuracyPct: pct(c.reduce((n, a) => n + credit(a.outcome), 0), c.length),
    avgSeconds: timed.length ? Math.round(timed.reduce((n, a) => n + a.timeMs, 0) / timed.length / 1000) : null,
    days: new Set(c.map((a) => a.attemptedAt.slice(0, 10))).size,
  }
}

export interface GroupRow { key: string; answers: number; accuracyPct: number }
/** Accuracy per group (subject or topic) for groups with at least `min` answers, weakest first. A question counts once per group it belongs to. */
export function weakGroups(attempts: WAttempt[], groupsOf: (questionId: string) => string[], min = 5): GroupRow[] {
  const m = new Map<string, { n: number; got: number }>()
  for (const a of counted(attempts)) for (const g of new Set(groupsOf(a.questionId))) {
    const r = m.get(g) ?? { n: 0, got: 0 }
    r.n++; r.got += credit(a.outcome); m.set(g, r)
  }
  return [...m.entries()].filter(([, r]) => r.n >= min).map(([key, r]) => ({ key, answers: r.n, accuracyPct: pct(r.got, r.n) as number })).sort((a, b) => a.accuracyPct - b.accuracyPct || b.answers - a.answers)
}

export interface ConfidenceRow { rating: 1 | 2 | 3 | 4 | 5; answers: number; accuracyPct: number | null }
export function confidenceCalibration(attempts: WAttempt[]): { rows: ConfidenceRow[]; rated: number; sureButWrong: number } {
  const c = counted(attempts).filter((a) => a.confidence != null)
  const rows = ([1, 2, 3, 4, 5] as const).map((rating) => {
    const x = c.filter((a) => a.confidence === rating)
    return { rating, answers: x.length, accuracyPct: pct(x.reduce((n, a) => n + credit(a.outcome), 0), x.length) }
  })
  return { rows, rated: c.length, sureButWrong: c.filter((a) => (a.confidence ?? 0) >= 4 && a.outcome === 'incorrect').length }
}

export interface WeekRow { weekStart: string; answers: number; accuracyPct: number | null }
/** The last `weeks` weeks (Monday to Sunday, UTC), oldest first, including empty weeks. */
export function weeklyTrend(attempts: WAttempt[], now: Date, weeks = 8): WeekRow[] {
  const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x }
  const start = monday(now)
  const rows: WeekRow[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(start.getTime() - i * 7 * 86400000)
    const to = new Date(from.getTime() + 7 * 86400000)
    const x = counted(attempts).filter((a) => { const t = new Date(a.attemptedAt).getTime(); return t >= from.getTime() && t < to.getTime() })
    rows.push({ weekStart: from.toISOString().slice(0, 10), answers: x.length, accuracyPct: pct(x.reduce((n, a) => n + credit(a.outcome), 0), x.length) })
  }
  return rows
}

export interface VersionRow { version: number; answers: number; correct: number; incorrect: number; partial: number; lastAt: string }
/** One question's answers split by the version that was answered, newest version first. */
export function byVersion(attempts: WAttempt[], questionId: string): VersionRow[] {
  const m = new Map<number, VersionRow>()
  for (const a of attempts) {
    if (a.questionId !== questionId || a.outcome === 'unanswered') continue
    const r = m.get(a.questionVersion) ?? { version: a.questionVersion, answers: 0, correct: 0, incorrect: 0, partial: 0, lastAt: a.attemptedAt }
    r.answers++; r[a.outcome]++
    if (a.attemptedAt > r.lastAt) r.lastAt = a.attemptedAt
    m.set(a.questionVersion, r)
  }
  return [...m.values()].sort((a, b) => b.version - a.version)
}
