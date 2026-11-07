import type { Attempt } from '../practice/attempts'
import { levelInfo, xpFor } from '../gamification/progress'

/**
 * Dashboard statistics, computed only from attempts recorded on this device.
 * XP and level come from src/gamification/progress.ts. Due revisions are computed on the Dashboard page itself.
 */
export interface DashboardStats {
  attempted: number
  correct: number
  accuracyPct: number | null
  streakDays: number
  xp: number
  level: number
  studyMinutesToday: number
  dailyGoal: number
  answeredToday: number
  dueRevisions: number
  /** Most recent study days first: local date, answers that day, correct that day. */
  recentDays: { date: string; answered: number; correct: number }[]
}

export { computeStreak, localDay, shiftDay } from './days'
import { localDay, computeStreak } from './days'

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
    xp: xpFor(attempts),
    level: levelInfo(xpFor(attempts)).level,
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
