import { useSyncExternalStore } from 'react'

/** The private workspace screens stay hidden until the owner switches them on (Settings → Experimental). Per user, per device. */
const KEY = (userId: string) => `shuvromed.workspace.enabled.v1.${userId}`
const listeners = new Set<() => void>()

export function getWorkspaceEnabled(userId: string): boolean {
  try { return localStorage.getItem(KEY(userId)) === '1' } catch { return false }
}
export function setWorkspaceEnabled(userId: string, on: boolean): boolean {
  try {
    if (on) localStorage.setItem(KEY(userId), '1')
    else localStorage.removeItem(KEY(userId))
  } catch {
    return false
  }
  listeners.forEach((l) => l())
  return true
}
export function useWorkspaceEnabled(userId: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (userId ? getWorkspaceEnabled(userId) : false),
    () => false,
  )
}
