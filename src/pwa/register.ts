import { useSyncExternalStore } from 'react'

/**
 * Service-worker lifecycle as a tiny store the UI can read.
 * - needRefresh: a new version is downloaded and waiting. Nothing changes until the student taps Reload.
 * - offlineReady: the app shell is saved, so the app opens without a network.
 */
export interface PwaState {
  needRefresh: boolean
  offlineReady: boolean
}

let state: PwaState = { needRefresh: false, offlineReady: false }
let updater: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const getPwaState = () => state
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const usePwa = () => useSyncExternalStore(subscribe, getPwaState, getPwaState)

/** Test hook and reset. */
export const _setPwaState = (p: Partial<PwaState>) => set(p)

export function dismissOfflineReady() {
  set({ offlineReady: false })
}
export function dismissNeedRefresh() {
  set({ needRefresh: false })
}

/** Installs the new version and reloads the page. */
export function applyUpdate() {
  void updater?.(true)
}

const HOUR_MS = 60 * 60 * 1000

/** Production only, and only where service workers exist. Safe to call more than once. */
export function initPwa() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || updater) return
  void import('virtual:pwa-register').then(({ registerSW }) => {
    updater = registerSW({
      onNeedRefresh: () => set({ needRefresh: true }),
      onOfflineReady: () => set({ offlineReady: true }),
      // Look for a new version about once an hour while the app stays open.
      onRegisteredSW: (_url, reg) => {
        if (reg) setInterval(() => void reg.update().catch(() => {}), HOUR_MS)
      },
    })
  })
}
