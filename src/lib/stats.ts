/**
 * Dashboard statistics.
 * Phase 1: no attempt data exists yet, so this returns honest zeros.
 * Phase 3+ replaces the source with real attempts (local + synced).
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
}

export function getDashboardStats(): DashboardStats {
  return {
    attempted: 0,
    correct: 0,
    accuracyPct: null,
    streakDays: 0,
    xp: 0,
    level: 1,
    studyMinutesToday: 0,
    dailyGoal: 20,
    answeredToday: 0,
    dueRevisions: 0,
  }
}

export function formatAccuracy(pct: number | null): string {
  return pct === null ? '—' : `${Math.round(pct)}%`
}
