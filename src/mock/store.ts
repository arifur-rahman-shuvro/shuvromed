import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { MockResultSchema, MockRunSchema, type MockResult, type MockRun } from './mock'

/**
 * Device storage for the exam in progress (so a refresh or a dropped connection never loses it) and
 * the finished results. Per user id. The answers themselves are ordinary attempts and sync like the rest;
 * this list of finished exams stays on this device (see docs/MOCK_AND_PROGRESS.md).
 */
const StateSchema = z.strictObject({ active: MockRunSchema.nullable(), results: z.array(MockResultSchema) })
export type MockState = z.infer<typeof StateSchema>

export const MAX_RESULTS = 30
const KEY = (userId: string) => `shuvromed.mock.v1.${userId}`
const EMPTY: MockState = { active: null, results: [] }
const cache = new Map<string, MockState>()
const listeners = new Set<() => void>()

function read(userId: string): MockState {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    const whole = StateSchema.safeParse(parsed)
    if (whole.success) return whole.data
    // Keep whatever is still valid rather than dropping all finished exams for one bad entry.
    const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as { active?: unknown; results?: unknown }
    const active = MockRunSchema.safeParse(obj.active)
    const results = Array.isArray(obj.results) ? obj.results.flatMap((r) => { const p = MockResultSchema.safeParse(r); return p.success ? [p.data] : [] }) : []
    return { active: active.success ? active.data : null, results }
  } catch {
    return EMPTY
  }
}

export function loadMock(userId: string): MockState {
  const hit = cache.get(userId)
  if (hit) return hit
  const fresh = read(userId)
  cache.set(userId, fresh)
  return fresh
}

export interface SaveResult { ok: boolean; error?: string }

function save(userId: string, next: MockState): SaveResult {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(next))
  } catch {
    return { ok: false, error: 'Your device would not let us save the exam (storage is full or blocked).' }
  }
  cache.set(userId, next)
  listeners.forEach((l) => l())
  return { ok: true }
}

export const saveActive = (userId: string, run: MockRun): SaveResult => save(userId, { ...loadMock(userId), active: run })
export const discardActive = (userId: string): SaveResult => save(userId, { ...loadMock(userId), active: null })

/** Stores the finished result and clears the exam in progress in one write. */
export function completeActive(userId: string, result: MockResult): SaveResult {
  const s = loadMock(userId)
  return save(userId, { active: null, results: [result, ...s.results.filter((r) => r.id !== result.id)].slice(0, MAX_RESULTS) })
}

/** Adds finished exams that are not already stored (by id), newest first, keeping the exam in progress. */
export function mergeResults(userId: string, incoming: readonly MockResult[]): SaveResult {
  const s = loadMock(userId)
  const have = new Set(s.results.map((r) => r.id))
  const fresh = incoming.filter((r) => !have.has(r.id))
  if (fresh.length === 0) return { ok: true }
  const merged = [...s.results, ...fresh].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0)).slice(0, MAX_RESULTS)
  return save(userId, { ...s, results: merged })
}

export function resetMockCache(): void {
  cache.clear()
  listeners.forEach((l) => l())
}

export function useMock(userId: string | undefined): MockState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => (userId ? loadMock(userId) : EMPTY),
    () => EMPTY,
  )
}
