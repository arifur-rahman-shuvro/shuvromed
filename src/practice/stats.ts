import type { Difficulty, Question } from '../content/schema'
import type { Attempt } from './attempts'
import { latestAttempts } from './session'

export interface TopicStats {
  questionCount: number
  /** Distinct questions answered at least once. */
  attemptedQuestions: number
  /** Total answers recorded, including repeats. */
  attempts: number
  /** Correct share of all recorded answers on these questions. Null if none. */
  accuracyPct: number | null
  /**
   * Share of the questions whose MOST RECENT answer was correct. Unattempted questions count as
   * not mastered. This is a simple, explainable measure, not a prediction of any exam result.
   */
  masteryPct: number | null
  difficultyMix: Record<Difficulty, number>
  examStyles: string[]
}

export function topicStats(questions: readonly Question[], history: readonly Attempt[]): TopicStats {
  const ids = new Set(questions.map((q) => q.id))
  const mine = history.filter((a) => ids.has(a.questionId))
  const latest = latestAttempts(mine)
  const correctAnswers = mine.filter((a) => a.isCorrect).length
  const mix: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 }
  const styles = new Set<string>()
  for (const q of questions) {
    mix[q.difficulty] += 1
    q.examTags.forEach((t) => styles.add(t))
  }
  const mastered = [...latest.values()].filter((a) => a.isCorrect).length
  return {
    questionCount: questions.length,
    attemptedQuestions: latest.size,
    attempts: mine.length,
    accuracyPct: mine.length === 0 ? null : (correctAnswers / mine.length) * 100,
    masteryPct: questions.length === 0 ? null : (mastered / questions.length) * 100,
    difficultyMix: mix,
    examStyles: [...styles].sort(),
  }
}
