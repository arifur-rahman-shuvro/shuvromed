import type { Attempt } from '../practice/attempts'
import { computeStreak, localDay, shiftDay } from '../lib/days'

/**
 * XP, levels, streaks and badges. All of it is computed from the answer history, nothing is stored,
 * so every device that holds the same answers shows the same numbers and nothing can be lost or
 * double-counted. The rules are plain constants below and are explained on the Progress page.
 */
export const XP_RULES = {
  practiceCorrect: 10,
  practiceWrong: 3, // a wrong answer still earns a little: reviewing mistakes is how you learn
  mockCorrect: 15,
  mockWrong: 4,
} as const

const byTime = (a: Attempt, b: Attempt) => (a.attemptedAt === b.attemptedAt ? a.id.localeCompare(b.id) : a.attemptedAt < b.attemptedAt ? -1 : 1)

/**
 * Only the FIRST answer to a question on a given day earns XP, so repeating the same question over
 * and over cannot farm points. (Re-answering still counts for accuracy, revision and streaks.)
 */
export function xpFor(attempts: readonly Attempt[]): number {
  const seen = new Set<string>()
  let xp = 0
  for (const a of [...attempts].sort(byTime)) {
    const key = `${localDay(new Date(a.attemptedAt))}|${a.questionId}`
    if (seen.has(key)) continue
    seen.add(key)
    const mock = a.mode === 'mock'
    xp += a.isCorrect ? (mock ? XP_RULES.mockCorrect : XP_RULES.practiceCorrect) : mock ? XP_RULES.mockWrong : XP_RULES.practiceWrong
  }
  return xp
}

/** Total XP needed to reach a level: 0, 100, 300, 600, 1000, 1500 ... (50 x L x (L-1)). */
export const xpForLevel = (level: number) => 50 * level * (level - 1)

export interface LevelInfo {
  level: number
  xp: number
  /** XP earned inside this level and the size of this level, for a progress bar. */
  into: number
  span: number
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level += 1
  return { level, xp, into: xp - xpForLevel(level), span: xpForLevel(level + 1) - xpForLevel(level) }
}

/** Longest run of consecutive study days ever. */
export function longestStreak(days: ReadonlySet<string>): number {
  let best = 0
  for (const d of days) {
    if (days.has(shiftDay(d, -1))) continue // only start counting at the beginning of a run
    let n = 0
    for (let c = d; days.has(c); c = shiftDay(c, 1)) n += 1
    best = Math.max(best, n)
  }
  return best
}

export interface BadgeDef {
  id: string
  name: string
  how: string
}

export const BADGES: readonly BadgeDef[] = [
  { id: 'first-answer', name: 'First step', how: 'Answer your first question.' },
  { id: 'answers-10', name: 'Warming up', how: 'Answer 10 questions.' },
  { id: 'answers-100', name: 'Centurion', how: 'Answer 100 questions.' },
  { id: 'answers-500', name: 'Dedicated', how: 'Answer 500 questions.' },
  { id: 'answers-1000', name: 'Marathon', how: 'Answer 1,000 questions.' },
  { id: 'streak-3', name: 'Three in a row', how: 'Study on 3 days in a row.' },
  { id: 'streak-7', name: 'One week', how: 'Study on 7 days in a row.' },
  { id: 'streak-30', name: 'One month', how: 'Study on 30 days in a row.' },
  { id: 'mock-first', name: 'Exam day', how: 'Answer a question in a mock exam.' },
  { id: 'mock-50', name: 'Exam regular', how: 'Answer 50 questions in mock exams.' },
  { id: 'revision-10', name: 'Reviser', how: 'Answer 10 questions in revision mode.' },
  { id: 'accuracy-80', name: 'Sharp', how: 'Reach 80% accuracy over at least 50 answers.' },
]

export interface EarnedBadge extends BadgeDef {
  /** ISO time the badge was first earned, or null if not yet. */
  earnedAt: string | null
}

export interface Progress {
  xp: number
  level: LevelInfo
  streakDays: number
  longestStreakDays: number
  badges: EarnedBadge[]
}

/** The time of the n-th attempt matching `pick`, or null. */
function nth(sorted: readonly Attempt[], n: number, pick: (a: Attempt) => boolean): string | null {
  let c = 0
  for (const a of sorted) if (pick(a) && ++c === n) return a.attemptedAt
  return null
}

function streakReached(days: ReadonlySet<string>, n: number): string | null {
  let best: string | null = null
  for (const d of days) {
    if (days.has(shiftDay(d, -1))) continue
    let len = 0
    for (let c = d; days.has(c); c = shiftDay(c, 1)) {
      len += 1
      if (len === n) {
        if (best === null || c < best) best = c
        break
      }
    }
  }
  return best ? new Date(`${best}T12:00:00`).toISOString() : null
}

export function buildProgress(attempts: readonly Attempt[], today: string = localDay(new Date())): Progress {
  const sorted = [...attempts].sort(byTime)
  const days = new Set(sorted.map((a) => localDay(new Date(a.attemptedAt))))
  const xp = xpFor(sorted)

  let accuracyAt: string | null = null
  let right = 0
  sorted.forEach((a, i) => {
    if (a.isCorrect) right += 1
    if (accuracyAt === null && i + 1 >= 50 && right / (i + 1) >= 0.8) accuracyAt = a.attemptedAt
  })

  const earned: Record<string, string | null> = {
    'first-answer': nth(sorted, 1, () => true),
    'answers-10': nth(sorted, 10, () => true),
    'answers-100': nth(sorted, 100, () => true),
    'answers-500': nth(sorted, 500, () => true),
    'answers-1000': nth(sorted, 1000, () => true),
    'streak-3': streakReached(days, 3),
    'streak-7': streakReached(days, 7),
    'streak-30': streakReached(days, 30),
    'mock-first': nth(sorted, 1, (a) => a.mode === 'mock'),
    'mock-50': nth(sorted, 50, (a) => a.mode === 'mock'),
    'revision-10': nth(sorted, 10, (a) => a.mode === 'revision'),
    'accuracy-80': accuracyAt,
  }
  return {
    xp,
    level: levelInfo(xp),
    streakDays: computeStreak(days, today),
    longestStreakDays: longestStreak(days),
    badges: BADGES.map((b) => ({ ...b, earnedAt: earned[b.id] ?? null })),
  }
}
