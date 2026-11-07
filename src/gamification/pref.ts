import { useSyncExternalStore } from 'react'

/**
 * "Show XP, levels and badges" switch. Stored on this device per user (not synced yet; the settings
 * page in Phase 7 will move it to the account). Streaks and counts are study statistics and stay visible.
 */
const KEY = (userId: string) => `shuvromed.gamification.v1.${userId}`
const listeners = new Set<() => void>()

export function getGamification(userId: string): boolean {
  try {
    return localStorage.getItem(KEY(userId)) !== 'off'
  } catch {
    return true
  }
}

export function setGamification(userId: string, on: boolean): boolean {
  try {
    localStorage.setItem(KEY(userId), on ? 'on' : 'off')
  } catch {
    return false
  }
  listeners.forEach((l) => l())
  return true
}

export function useGamification(userId: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (userId ? getGamification(userId) : true),
    () => true,
  )
}
