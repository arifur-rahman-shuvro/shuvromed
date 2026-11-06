import type { Attempt } from '../practice/attempts'

/**
 * Dashboard statistics, computed only from attempts recorded on this device.
 * XP and levels are not computed yet (Phase 5) and are reported as null rather than invented.
 * Due revisions are 0 until the spaced-repetition schedule exists (Phase 4).
 */
export interface DashboardStats {
  attempted: number
  correct: number
  accuracyPct: number | null
  streakDays: number
  xp: number | null
  level: number | null
  studyMinutesToday: number
  dailyGoal: number
  answeredToday: number
  dueRevisions: number
  /** Most recent study days first: local date, answers that day, correct that day. */
  recentDays: { date: string; answered: number; correct: number }[]
}

/** Local calendar date as YYYY-MM-DD (the student's own day, not UTC). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + delta))
}

/**
 * Consecutive days with at least one answer. A streak is still alive if the last study day was
 * yesterday (today is not over yet); it is 0 once a full day has been missed.
 */
export function computeStreak(days: ReadonlySet<string>, today: string): number {
  let cursor = days.has(today) ? today : shiftDay(today, -1)
  let n = 0
  while (days.has(cursor)) {
    n += 1
    cursor = shiftDay(cursor, -1)
  }
  return n
}

export function getDashboardStats(attempts: readonly Attempt[] = [], now: Date = new Date(), dailyGoal = 20): DashboardStats {
  const today = localDay(now)
  const perDay = new Map<string, { answered: number; correct: number; ms: number }>()
  for (const a of attempts) {
    const day = localDay(new Date(a.attemptedAt))
    const g = perDay.get(day) ?? { answered: 0, correct: 0, ms: 0 }
    g.answered += 1
    if (a.isCorrect) g.correct += 1
    g.ms += a.timeMs
    perDay.set(day, g)
  }
  const correct = attempts.filter((a) => a.isCorrect).length
  const t = perDay.get(today)
  return {
    attempted: attempts.length,
    correct,
    accuracyPct: attempts.length === 0 ? null : (correct / attempts.length) * 100,
    streakDays: computeStreak(new Set(perDay.keys()), today),
    xp: null,
    level: null,
    studyMinutesToday: t ? Math.round(t.ms / 60000) : 0,
    dailyGoal,
    answeredToday: t?.answered ?? 0,
    dueRevisions: 0,
    recentDays: [...perDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 5)
      .map(([date, g]) => ({ date, answered: g.answered, correct: g.correct })),
  }
}

export function formatAccuracy(pct: number | null): string {
  return pct === null ? '—' : `${Math.round(pct)}%`
}
