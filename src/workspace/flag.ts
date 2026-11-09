import { useSyncExternalStore } from 'react'

/**
 * Since the cutover (Phase 10) the private workspace is the main menu for everyone. The switch in Settings stays as a way back
 * to the old demo menu: an explicit choice (on or off) is remembered; no choice means on. Per user, per device.
 */
const KEY = (userId: string) => `shuvromed.workspace.enabled.v1.${userId}`
const LEGACY_KEY = (userId: string) => `shuvromed.legacy.visible.v1.${userId}`
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function getWorkspaceEnabled(userId: string): boolean {
  try { return localStorage.getItem(KEY(userId)) !== '0' } catch { return true }
}
export function setWorkspaceEnabled(userId: string, on: boolean): boolean {
  try {
    localStorage.setItem(KEY(userId), on ? '1' : '0')
  } catch {
    return false
  }
  notify()
  return true
}
/** Whether the old demo screens (Subjects, Revision, Bookmarks, Notebook, Mock exam, Progress, Analytics) are listed in the menu. Their data is kept either way. */
export function getLegacyVisible(userId: string): boolean {
  try { return localStorage.getItem(LEGACY_KEY(userId)) === '1' } catch { return false }
}
export function setLegacyVisible(userId: string, on: boolean): boolean {
  try {
    if (on) localStorage.setItem(LEGACY_KEY(userId), '1')
    else localStorage.removeItem(LEGACY_KEY(userId))
  } catch {
    return false
  }
  notify()
  return true
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb) }
export function useLegacyVisible(userId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (userId ? getLegacyVisible(userId) : false), () => false)
}
export function useWorkspaceEnabled(userId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? getWorkspaceEnabled(userId) : false),
    () => false,
  )
}
