import { useSyncExternalStore } from 'react'

/** Per-user preferences kept on this device. (Moving them to the account is possible later; see docs/SYNC.md.) */
export const DEFAULT_DAILY_GOAL = 20
export const MIN_DAILY_GOAL = 1
export const MAX_DAILY_GOAL = 500

const KEY = (userId: string) => `shuvromed.settings.v1.${userId}`
const listeners = new Set<() => void>()

export const clampGoal = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, Math.round(n))) : DEFAULT_DAILY_GOAL)

export function getDailyGoal(userId: string): number {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return DEFAULT_DAILY_GOAL
    const v = (JSON.parse(raw) as { dailyGoal?: unknown }).dailyGoal
    return typeof v === 'number' ? clampGoal(v) : DEFAULT_DAILY_GOAL
  } catch {
    return DEFAULT_DAILY_GOAL
  }
}

export function setDailyGoal(userId: string, goal: number): boolean {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify({ dailyGoal: clampGoal(goal) }))
  } catch {
    return false
  }
  listeners.forEach((l) => l())
  return true
}

export function useDailyGoal(userId: string | undefined): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (userId ? getDailyGoal(userId) : DEFAULT_DAILY_GOAL),
    () => DEFAULT_DAILY_GOAL,
  )
}
