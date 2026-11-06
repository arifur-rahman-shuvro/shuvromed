import type { Difficulty, OptionId, Question } from '../content/schema'

export function isCorrect(q: Question, selected: OptionId): boolean {
  return q.correctOptionId === selected
}

export interface SessionAnswer {
  questionId: string
  topicId: string
  subjectId: string
  difficulty: Difficulty
  selectedOptionId: OptionId
  isCorrect: boolean
  timeMs: number
}

export interface GroupScore {
  answered: number
  correct: number
  accuracyPct: number | null
}

export interface SessionSummary {
  total: number
  answered: number
  correct: number
  incorrect: number
  skipped: number
  /** Correct as a share of the questions actually answered. Null when nothing was answered. */
  accuracyPct: number | null
  /** Correct as a share of ALL questions in the session; skipped ones count as not correct. */
  scorePct: number | null
  avgTimeMs: number | null
  byTopic: Record<string, GroupScore>
  byDifficulty: Record<string, GroupScore>
}

const pct = (part: number, whole: number): number | null => (whole === 0 ? null : (part / whole) * 100)

function group(answers: SessionAnswer[], key: (a: SessionAnswer) => string): Record<string, GroupScore> {
  const out: Record<string, GroupScore> = {}
  for (const a of answers) {
    const g = (out[key(a)] ??= { answered: 0, correct: 0, accuracyPct: null })
    g.answered += 1
    if (a.isCorrect) g.correct += 1
  }
  for (const g of Object.values(out)) g.accuracyPct = pct(g.correct, g.answered)
  return out
}

/** Scores a finished (or ended-early) session. `total` is how many questions the session contained. */
export function summarize(answers: SessionAnswer[], total: number): SessionSummary {
  const answered = answers.length
  const correct = answers.filter((a) => a.isCorrect).length
  const timeSum = answers.reduce((n, a) => n + a.timeMs, 0)
  return {
    total,
    answered,
    correct,
    incorrect: answered - correct,
    skipped: Math.max(0, total - answered),
    accuracyPct: pct(correct, answered),
    scorePct: pct(correct, total),
    avgTimeMs: answered === 0 ? null : timeSum / answered,
    byTopic: group(answers, (a) => a.topicId),
    byDifficulty: group(answers, (a) => a.difficulty),
  }
}

/** Timed practice allows this long in total. A plain, documented rule rather than a hidden one. */
export const SECONDS_PER_QUESTION = 90
export function timeLimitMs(questionCount: number): number {
  return questionCount * SECONDS_PER_QUESTION * 1000
}
