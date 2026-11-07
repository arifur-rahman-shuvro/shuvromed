import { useSyncExternalStore } from 'react'
import { UserDataSchema, emptyUserData, type Edit, type UserData } from './model'

/**
 * Device storage for one signed-in user's bookmarks, notes and flags (key per user id, so two
 * accounts on one phone never mix). Corrupt or unknown data is discarded as a whole rather than
 * half-trusted, because a partial parse could silently lose sync bookkeeping.
 */
const KEY = (userId: string) => `shuvromed.userdata.v1.${userId}`
const cache = new Map<string, UserData>()
const listeners = new Set<() => void>()
const EMPTY = emptyUserData()

function read(userId: string): UserData {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return emptyUserData()
    const r = UserDataSchema.safeParse(JSON.parse(raw))
    return r.success ? r.data : emptyUserData()
  } catch {
    return emptyUserData()
  }
}

export function loadUserData(userId: string): UserData {
  const hit = cache.get(userId)
  if (hit) return hit
  const fresh = read(userId)
  cache.set(userId, fresh)
  return fresh
}

export interface SaveResult {
  ok: boolean
  error?: string
}

/** Stores a new version. Fails visibly if the device refuses (storage full or blocked). */
export function saveUserData(userId: string, next: UserData): SaveResult {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(next))
  } catch {
    return { ok: false, error: 'Your device would not let us save this (storage is full or blocked).' }
  }
  cache.set(userId, next)
  listeners.forEach((l) => l())
  return { ok: true }
}

/** Applies a pure edit and stores the result. */
export function updateUserData(userId: string, change: (d: UserData) => UserData | Edit): SaveResult {
  const out = change(loadUserData(userId))
  if ('ok' in out) {
    if (!out.ok) return { ok: false, error: out.error }
    return saveUserData(userId, out.data)
  }
  return saveUserData(userId, out)
}

export function resetUserDataCache(): void {
  cache.clear()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useUserData(userId: string | undefined): UserData {
  return useSyncExternalStore(subscribe, () => (userId ? loadUserData(userId) : EMPTY), () => EMPTY)
}
