import { descendantIds } from '../content/tree'
import type { Difficulty, Question, Topic } from '../content/schema'
import type { Attempt } from './attempts'
import { hashSeed, mulberry32, shuffled } from './shuffle'

export type PracticeMode = 'all' | 'incorrect' | 'unattempted' | 'bookmarked' | 'due'

/** Extra facts some modes need. Missing sets mean "none": a bookmark/due mode then matches nothing. */
export interface PracticeContext {
  bookmarkedIds?: ReadonlySet<string>
  dueIds?: ReadonlySet<string>
}

export interface PracticeConfig {
  subjectId: string | null
  topicId: string | null
  examStyle: string | null
  difficulty: Difficulty | null
  count: number
  mode: PracticeMode
  timed: boolean
  shuffleQuestions: boolean
  shuffleOptions: boolean
}

export const MAX_SESSION_QUESTIONS = 100

export const DEFAULT_CONFIG: PracticeConfig = {
  subjectId: null,
  topicId: null,
  examStyle: null,
  difficulty: null,
  count: 10,
  mode: 'all',
  timed: false,
  shuffleQuestions: true,
  shuffleOptions: true,
}

/** Latest attempt per question, by time. */
export function latestAttempts(history: readonly Attempt[]): Map<string, Attempt> {
  const out = new Map<string, Attempt>()
  for (const a of history) {
    const prev = out.get(a.questionId)
    if (!prev || a.attemptedAt >= prev.attemptedAt) out.set(a.questionId, a)
  }
  return out
}

/** Every question that matches the filters, before the count limit is applied. */
export function matchingQuestions(
  pool: readonly Question[],
  topics: readonly Topic[],
  cfg: PracticeConfig,
  history: readonly Attempt[],
  ctx: PracticeContext = {},
): Question[] {
  const topicIds = cfg.topicId ? descendantIds(topics, cfg.topicId) : null
  const latest = latestAttempts(history)
  return pool
    .filter((q) => {
      if (cfg.subjectId && q.subjectId !== cfg.subjectId) return false
      if (topicIds && !topicIds.has(q.topicId)) return false
      if (cfg.examStyle && !q.examTags.includes(cfg.examStyle)) return false
      if (cfg.difficulty && q.difficulty !== cfg.difficulty) return false
      const last = latest.get(q.id)
      if (cfg.mode === 'unattempted' && last) return false
      if (cfg.mode === 'incorrect' && !(last && !last.isCorrect)) return false
      if (cfg.mode === 'bookmarked' && !ctx.bookmarkedIds?.has(q.id)) return false
      if (cfg.mode === 'due' && !ctx.dueIds?.has(q.id)) return false
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.count
  return Math.min(MAX_SESSION_QUESTIONS, Math.max(1, Math.floor(n)))
}

/** The questions for one session: filtered, optionally shuffled, then limited to the requested count. */
export function selectQuestions(
  pool: readonly Question[],
  topics: readonly Topic[],
  cfg: PracticeConfig,
  history: readonly Attempt[],
  seed: string,
  ctx: PracticeContext = {},
): Question[] {
  const matches = matchingQuestions(pool, topics, cfg, history, ctx)
  const ordered = cfg.shuffleQuestions ? shuffled(matches, mulberry32(hashSeed(`${seed}:order`))) : matches
  return ordered.slice(0, clampCount(cfg.count))
}
