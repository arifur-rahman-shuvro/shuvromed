import type { Attempt } from './attempts'

/**
 * Spaced repetition, derived entirely from the answer history. Nothing is stored that cannot be
 * recomputed, so two devices holding the same attempts always agree on what is due.
 *
 * The scheduler is a simplified SM-2: a wrong answer resets the interval to 1 day and lowers the ease;
 * a right answer grows the interval (1 day, then 3 days, then interval x ease). A low confidence
 * rating on a right answer ("guess") grows it more slowly; a high one grows it faster.
 */
export interface ReviewState {
  questionId: string
  dueAt: string // ISO timestamp
  intervalDays: number
  ease: number
  repetitions: number
  lapses: number
  lastReviewedAt: string
}

export const MIN_EASE = 1.3
export const MAX_EASE = 5
export const START_EASE = 2.5
export const MAX_INTERVAL_DAYS = 365
const DAY_MS = 86_400_000

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Applies one answer to the previous state (or to nothing, for a first answer). */
export function applyAttempt(prev: ReviewState | null, a: Pick<Attempt, 'questionId' | 'isCorrect' | 'confidence' | 'attemptedAt'>): ReviewState {
  let ease = prev?.ease ?? START_EASE
  let reps = prev?.repetitions ?? 0
  let lapses = prev?.lapses ?? 0
  let interval = prev?.intervalDays ?? 0

  if (!a.isCorrect) {
    ease = clamp(ease - 0.2, MIN_EASE, MAX_EASE)
    reps = 0
    lapses += 1
    interval = 1
  } else {
    const c = a.confidence ?? 3
    if (c <= 2) ease = clamp(ease - 0.15, MIN_EASE, MAX_EASE)
    else if (c >= 4) ease = clamp(ease + 0.1, MIN_EASE, MAX_EASE)
    const base = reps === 0 ? 1 : reps === 1 ? 3 : interval * ease
    const factor = c <= 2 ? 0.6 : c >= 5 ? 1.3 : 1
    interval = clamp(Math.max(1, base * factor), 1, MAX_INTERVAL_DAYS)
    reps += 1
  }
  interval = round2(interval)
  const t = Date.parse(a.attemptedAt)
  return {
    questionId: a.questionId,
    dueAt: new Date(t + interval * DAY_MS).toISOString(),
    intervalDays: interval,
    ease: round2(ease),
    repetitions: reps,
    lapses,
    lastReviewedAt: a.attemptedAt,
  }
}

/** Replays the whole history in time order (ties broken by id) to get each question's current schedule. */
export function buildSchedule(history: readonly Attempt[]): Map<string, ReviewState> {
  const ordered = [...history].sort((x, y) => (x.attemptedAt === y.attemptedAt ? x.id.localeCompare(y.id) : x.attemptedAt < y.attemptedAt ? -1 : 1))
  const out = new Map<string, ReviewState>()
  for (const a of ordered) out.set(a.questionId, applyAttempt(out.get(a.questionId) ?? null, a))
  return out
}

/** Questions whose review date has arrived, most overdue first. */
export function dueQuestions(schedule: ReadonlyMap<string, ReviewState>, now: Date = new Date()): ReviewState[] {
  const t = now.getTime()
  return [...schedule.values()].filter((s) => Date.parse(s.dueAt) <= t).sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : a.questionId.localeCompare(b.questionId)))
}
