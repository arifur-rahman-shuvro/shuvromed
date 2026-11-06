import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { OptionIdSchema } from '../content/schema'

/**
 * One recorded answer. The id is generated on the device so that, when sync arrives, a retried
 * upload of the same attempt can be recognised and not counted twice (the database id is the key).
 */
export const AttemptSchema = z.strictObject({
  id: z.uuid(),
  questionId: z.string().min(1).max(100),
  selectedOptionId: OptionIdSchema,
  isCorrect: z.boolean(),
  timeMs: z.number().int().min(0).max(3_600_000),
  mode: z.enum(['practice', 'mock', 'revision']),
  attemptedAt: z.iso.datetime({ offset: true }),
  contentVersion: z.string().max(64),
})
export type Attempt = z.infer<typeof AttemptSchema>

const KEY = (userId: string) => `shuvromed.attempts.v1.${userId}`
const cache = new Map<string, Attempt[]>()
const listeners = new Set<() => void>()
const EMPTY: Attempt[] = []

function read(userId: string): Attempt[] {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Keep every well-formed entry and silently drop corrupt ones instead of losing everything.
    return parsed.flatMap((p) => {
      const r = AttemptSchema.safeParse(p)
      return r.success ? [r.data] : []
    })
  } catch {
    return []
  }
}

/** Attempts saved on this device for this signed-in user. Stable reference until something changes. */
export function loadAttempts(userId: string): Attempt[] {
  const hit = cache.get(userId)
  if (hit) return hit
  const fresh = read(userId)
  cache.set(userId, fresh)
  return fresh
}

export interface SaveResult {
  ok: boolean
  /** Why it failed, in words a student can act on. */
  error?: string
}

/** Appends an attempt. Fails visibly (never silently) if the device refuses to store it. */
export function addAttempt(userId: string, attempt: Attempt): SaveResult {
  const parsed = AttemptSchema.safeParse(attempt)
  if (!parsed.success) return { ok: false, error: 'This answer could not be recorded (invalid data).' }
  const current = loadAttempts(userId)
  if (current.some((a) => a.id === parsed.data.id)) return { ok: true } // duplicate submission: already stored
  const next = [...current, parsed.data]
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(next))
  } catch {
    return { ok: false, error: 'Your device would not let us save progress (storage is full or blocked).' }
  }
  cache.set(userId, next)
  listeners.forEach((l) => l())
  return { ok: true }
}

/** Test and sign-out helper: forget the in-memory copy so the next read goes back to storage. */
export function resetAttemptCache(): void {
  cache.clear()
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useAttempts(userId: string | undefined): Attempt[] {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? loadAttempts(userId) : EMPTY),
    () => EMPTY,
  )
}

export function newAttemptId(): string {
  return crypto.randomUUID()
}
