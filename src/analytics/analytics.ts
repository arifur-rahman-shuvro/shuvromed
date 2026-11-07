import type { Difficulty, Question, Subject, Topic } from '../content/schema'
import { localDay, shiftDay } from '../lib/days'
import type { MockResult } from '../mock/mock'
import type { Attempt } from '../practice/attempts'
import { latestAttempts } from '../practice/session'

/**
 * Analytics, computed only from the student's own answers and the question bank. Pure (no storage,
 * no clock of its own). These are descriptive statistics of what the student did, not predictions
 * of any exam result.
 */
export const MIN_ANSWERS_FOR_WEAK = 3 // fewer answers than this is too little to call a topic weak
export const WEAK_BELOW_PCT = 70
export const TREND_DAYS = 14

const pct = (num: number, den: number): number | null => (den === 0 ? null : (num / den) * 100)

export interface Group {
  id: string
  name: string
  answers: number
  correct: number
  accuracyPct: number | null
  questionCount: number
  /** Distinct questions answered at least once. */
  attemptedQuestions: number
  /** Share of the questions whose latest answer was right (unanswered count as not mastered). */
  masteryPct: number | null
  avgSeconds: number | null
}

export interface TopicGroup extends Group {
  subjectId: string
}

export interface ConfidenceRow {
  rating: 1 | 2 | 3 | 4 | 5
  answers: number
  accuracyPct: number | null
}

export interface DayRow {
  date: string
  answered: number
  correct: number
}

export interface MockPoint {
  id: string
  finishedAt: string
  scorePct: number
  total: number
}

export interface Analytics {
  answers: number
  distinctQuestions: number
  accuracyPct: number | null
  avgSeconds: number | null
  /** Answers on questions that are no longer in the question bank; left out of every breakdown. */
  orphanedAnswers: number
  subjects: Group[]
  topics: TopicGroup[]
  /** Topics with enough answers and accuracy below WEAK_BELOW_PCT, weakest first. */
  weakTopics: TopicGroup[]
  /** Topics with some answers but too few to judge. */
  tooFewTopics: number
  difficulty: { difficulty: Difficulty; answers: number; accuracyPct: number | null }[]
  confidence: ConfidenceRow[]
  ratedAnswers: number
  /** Wrong answers given with confidence 4 or 5 (sure but wrong): the most useful ones to revisit. */
  sureButWrong: number
  /** Right answers given with confidence 1 or 2 (lucky or under-confident). */
  unsureButRight: number
  days: DayRow[]
  avgSecondsByMode: { mode: Attempt['mode']; answers: number; avgSeconds: number | null }[]
  mocks: MockPoint[]
}

function groupStats(id: string, name: string, qs: readonly Question[], mine: readonly Attempt[]): Group {
  const ids = new Set(qs.map((q) => q.id))
  const a = mine.filter((x) => ids.has(x.questionId))
  const latest = latestAttempts(a)
  const correct = a.filter((x) => x.isCorrect).length
  const ms = a.reduce((n, x) => n + x.timeMs, 0)
  return {
    id, name, answers: a.length, correct, accuracyPct: pct(correct, a.length),
    questionCount: qs.length, attemptedQuestions: latest.size,
    masteryPct: pct([...latest.values()].filter((x) => x.isCorrect).length, qs.length),
    avgSeconds: a.length === 0 ? null : ms / a.length / 1000,
  }
}

export function buildAnalytics(
  attempts: readonly Attempt[],
  questions: readonly Question[],
  topics: readonly Topic[],
  subjects: readonly Subject[],
  mockResults: readonly MockResult[],
  today: string = localDay(new Date()),
): Analytics {
  const known = new Set(questions.map((q) => q.id))
  const mine = attempts.filter((a) => known.has(a.questionId))
  const byId = new Map(questions.map((q) => [q.id, q]))
  const correct = mine.filter((a) => a.isCorrect).length

  const subjectRows = subjects.map((s) => groupStats(s.id, s.name, questions.filter((q) => q.subjectId === s.id), mine)).filter((g) => g.questionCount > 0)
  const topicRows: TopicGroup[] = topics
    .map((t) => ({ ...groupStats(t.id, t.name, questions.filter((q) => q.topicId === t.id), mine), subjectId: t.subjectId }))
    .filter((g) => g.questionCount > 0)
  const weakTopics = topicRows
    .filter((g) => g.answers >= MIN_ANSWERS_FOR_WEAK && (g.accuracyPct ?? 100) < WEAK_BELOW_PCT)
    .sort((a, b) => (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0) || b.answers - a.answers || a.name.localeCompare(b.name))

  const difficulty = (['easy', 'medium', 'hard'] as const).map((d) => {
    const a = mine.filter((x) => byId.get(x.questionId)?.difficulty === d)
    return { difficulty: d, answers: a.length, accuracyPct: pct(a.filter((x) => x.isCorrect).length, a.length) }
  })

  const rated = mine.filter((a) => a.confidence !== undefined)
  const confidence = ([1, 2, 3, 4, 5] as const).map((r) => {
    const a = rated.filter((x) => x.confidence === r)
    return { rating: r, answers: a.length, accuracyPct: pct(a.filter((x) => x.isCorrect).length, a.length) }
  })

  const perDay = new Map<string, DayRow>()
  for (const a of mine) {
    const date = localDay(new Date(a.attemptedAt))
    const row = perDay.get(date) ?? { date, answered: 0, correct: 0 }
    row.answered += 1
    if (a.isCorrect) row.correct += 1
    perDay.set(date, row)
  }
  const days: DayRow[] = []
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = shiftDay(today, -i)
    days.push(perDay.get(date) ?? { date, answered: 0, correct: 0 })
  }

  const modes = (['practice', 'mock', 'revision'] as const).map((mode) => {
    const a = mine.filter((x) => x.mode === mode)
    return { mode, answers: a.length, avgSeconds: a.length === 0 ? null : a.reduce((n, x) => n + x.timeMs, 0) / a.length / 1000 }
  })

  return {
    answers: mine.length,
    distinctQuestions: latestAttempts(mine).size,
    accuracyPct: pct(correct, mine.length),
    avgSeconds: mine.length === 0 ? null : mine.reduce((n, a) => n + a.timeMs, 0) / mine.length / 1000,
    orphanedAnswers: attempts.length - mine.length,
    subjects: subjectRows,
    topics: topicRows,
    weakTopics,
    tooFewTopics: topicRows.filter((g) => g.answers > 0 && g.answers < MIN_ANSWERS_FOR_WEAK).length,
    difficulty,
    confidence,
    ratedAnswers: rated.length,
    sureButWrong: rated.filter((a) => !a.isCorrect && (a.confidence ?? 0) >= 4).length,
    unsureButRight: rated.filter((a) => a.isCorrect && (a.confidence ?? 9) <= 2).length,
    days,
    avgSecondsByMode: modes,
    mocks: [...mockResults]
      .sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1))
      .slice(-10)
      .map((r) => ({ id: r.id, finishedAt: r.finishedAt, scorePct: r.total === 0 ? 0 : (r.correct / r.total) * 100, total: r.total })),
  }
}
