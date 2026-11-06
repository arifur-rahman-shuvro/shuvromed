import type { OptionId, Question } from '../content/schema'
import { OPTION_IDS } from '../content/schema'

/** Small deterministic PRNG. The same seed always gives the same order, so a re-render never reshuffles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash -> 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Fisher-Yates on a copy. Never mutates the input. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface DisplayOption {
  /** Letter the student sees, by position: A, B, C... */
  label: OptionId
  /** The option's original id in the question data. Scoring and analysis always use this. */
  id: OptionId
  text: string
}

export interface PresentedQuestion {
  question: Question
  options: DisplayOption[]
  /** Letter the student sees for the correct option. */
  correctLabel: OptionId
}

/**
 * Prepares a question for display. Options are shuffled only when asked to and only when the
 * question allows it (fixedOptionOrder keeps e.g. "All of the above" last). The result is
 * deterministic for a given seed and question id.
 */
export function presentQuestion(q: Question, opts: { shuffleOptions: boolean; seed: string }): PresentedQuestion {
  const ordered =
    opts.shuffleOptions && !q.fixedOptionOrder
      ? shuffled(q.options, mulberry32(hashSeed(`${opts.seed}:${q.id}`)))
      : [...q.options]
  const options: DisplayOption[] = ordered.map((o, i) => ({ label: OPTION_IDS[i], id: o.id, text: o.text }))
  const correct = options.find((o) => o.id === q.correctOptionId)
  if (!correct) throw new Error(`question ${q.id} has no option matching correctOptionId`)
  return { question: q, options, correctLabel: correct.label }
}
