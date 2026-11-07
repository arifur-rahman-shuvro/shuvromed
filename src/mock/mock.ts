import { z } from 'zod'
import { OptionIdSchema, type OptionId, type Question, type Topic } from '../content/schema'
import type { Attempt } from '../practice/attempts'
import { DEFAULT_CONFIG, MAX_SESSION_QUESTIONS, matchingQuestions } from '../practice/session'
import { hashSeed, mulberry32, shuffled } from '../practice/shuffle'
import { summarize, type SessionAnswer } from '../practice/scoring'

/**
 * Mock exams. Differences from practice, by design: no feedback until the end, answers can be changed,
 * questions can be flagged for review, one countdown for the whole exam, and an unanswered question
 * counts as wrong. This file is pure (no storage, no clock of its own) so the rules can be tested directly.
 */
export const MOCK_SECONDS_PER_QUESTION = [60, 90, 120] as const
export const MOCK_MAX_QUESTIONS = MAX_SESSION_QUESTIONS

const Iso = z.iso.datetime({ offset: true })

export const MockConfigSchema = z.strictObject({
  subjectId: z.string().min(1).max(100).nullable(),
  topicId: z.string().min(1).max(100).nullable(),
  examStyle: z.string().min(1).max(100).nullable(),
  count: z.number().int().min(1).max(MOCK_MAX_QUESTIONS),
  secondsPerQuestion: z.number().int().min(30).max(600),
})
export type MockConfig = z.infer<typeof MockConfigSchema>

export const DEFAULT_MOCK: MockConfig = { subjectId: null, topicId: null, examStyle: null, count: 20, secondsPerQuestion: 90 }

const AnswerMap = z.record(z.string().max(100), OptionIdSchema)

export const MockRunSchema = z.strictObject({
  id: z.uuid(),
  seed: z.string().min(1).max(40),
  config: MockConfigSchema,
  questionIds: z.array(z.string().max(100)).min(1).max(MOCK_MAX_QUESTIONS),
  startedAt: Iso,
  deadline: Iso,
  answers: AnswerMap,
  flagged: z.array(z.string().max(100)),
  spentMs: z.record(z.string().max(100), z.number().int().min(0).max(86_400_000)),
  current: z.number().int().min(0),
  contentVersion: z.string().max(64),
})
export type MockRun = z.infer<typeof MockRunSchema>

export const MockResultSchema = z.strictObject({
  id: z.uuid(),
  seed: z.string().min(1).max(40),
  config: MockConfigSchema,
  questionIds: z.array(z.string().max(100)),
  answers: AnswerMap,
  flagged: z.array(z.string().max(100)),
  startedAt: Iso,
  finishedAt: Iso,
  total: z.number().int().min(1),
  answered: z.number().int().min(0),
  correct: z.number().int().min(0),
  timedOut: z.boolean(),
})
export type MockResult = z.infer<typeof MockResultSchema>

export const clampMockCount = (n: number) => (Number.isFinite(n) ? Math.min(MOCK_MAX_QUESTIONS, Math.max(1, Math.round(n))) : DEFAULT_MOCK.count)
export const totalSeconds = (cfg: Pick<MockConfig, 'count' | 'secondsPerQuestion'>, questions = cfg.count) => questions * cfg.secondsPerQuestion

/** The questions for a new exam: matching the filters, shuffled by the seed, capped at the requested count. */
export function buildMock(pool: readonly Question[], topics: readonly Topic[], cfg: MockConfig, seed: string): Question[] {
  const matches = matchingQuestions(pool, topics, { ...DEFAULT_CONFIG, subjectId: cfg.subjectId, topicId: cfg.topicId, examStyle: cfg.examStyle, mode: 'all' }, [])
  return shuffled(matches, mulberry32(hashSeed(`${seed}:mock`))).slice(0, clampMockCount(cfg.count))
}

export function startRun(questions: readonly Question[], cfg: MockConfig, seed: string, id: string, now: Date, contentVersion: string): MockRun {
  const ms = totalSeconds(cfg, questions.length) * 1000
  return {
    id, seed, config: { ...cfg, count: questions.length }, questionIds: questions.map((q) => q.id),
    startedAt: now.toISOString(), deadline: new Date(now.getTime() + ms).toISOString(),
    answers: {}, flagged: [], spentMs: {}, current: 0, contentVersion,
  }
}

export const remainingMs = (run: MockRun, now: Date) => Math.max(0, Date.parse(run.deadline) - now.getTime())

/** Choosing the same option again clears the answer; null clears it too. */
export function setAnswer(run: MockRun, questionId: string, option: OptionId | null): MockRun {
  if (!run.questionIds.includes(questionId)) return run
  const answers = { ...run.answers }
  if (option === null || answers[questionId] === option) delete answers[questionId]
  else answers[questionId] = option
  return { ...run, answers }
}

export function toggleFlag(run: MockRun, questionId: string): MockRun {
  if (!run.questionIds.includes(questionId)) return run
  return { ...run, flagged: run.flagged.includes(questionId) ? run.flagged.filter((q) => q !== questionId) : [...run.flagged, questionId] }
}

export function goTo(run: MockRun, index: number, spentMsOnLeft = 0): MockRun {
  const left = run.questionIds[run.current]
  const spentMs = left && spentMsOnLeft > 0 ? { ...run.spentMs, [left]: Math.min(86_400_000, (run.spentMs[left] ?? 0) + Math.round(spentMsOnLeft)) } : run.spentMs
  return { ...run, spentMs, current: Math.min(run.questionIds.length - 1, Math.max(0, index)) }
}

export const unansweredCount = (run: MockRun) => run.questionIds.length - Object.keys(run.answers).filter((id) => run.questionIds.includes(id)).length

export interface Finished {
  result: MockResult
  attempts: Attempt[]
}

/**
 * Grades the exam. Each answered question becomes one attempt (mode 'mock'), so XP, streaks, revision
 * scheduling and sync all treat it like any other answer. Unanswered questions record nothing but count as wrong
 * in the score. `newId` supplies attempt ids so tests can be deterministic.
 */
export function finishRun(run: MockRun, questions: readonly Question[], now: Date, timedOut: boolean, newId: () => string): Finished {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const answeredIds = run.questionIds.filter((id) => run.answers[id] && byId.has(id))
  const finishedAt = new Date(Math.max(now.getTime(), Date.parse(run.startedAt)))
  const attempts: Attempt[] = answeredIds.map((id, i) => {
    const q = byId.get(id) as Question
    const selected = run.answers[id]
    return {
      id: newId(), questionId: id, selectedOptionId: selected, isCorrect: selected === q.correctOptionId,
      timeMs: Math.min(3_600_000, run.spentMs[id] ?? 0), mode: 'mock' as const,
      attemptedAt: new Date(finishedAt.getTime() - (answeredIds.length - i)).toISOString(), contentVersion: run.contentVersion,
    }
  })
  const result: MockResult = {
    id: run.id, seed: run.seed, config: run.config, questionIds: run.questionIds, answers: run.answers, flagged: run.flagged,
    startedAt: run.startedAt, finishedAt: finishedAt.toISOString(), total: run.questionIds.length,
    answered: attempts.length, correct: attempts.filter((a) => a.isCorrect).length, timedOut,
  }
  return { result, attempts }
}

export const scorePct = (r: Pick<MockResult, 'correct' | 'total'>) => (r.total === 0 ? 0 : (r.correct / r.total) * 100)

/** Per-topic / per-difficulty breakdown of a finished exam, from the questions it contained. */
export function summarizeResult(result: MockResult, questions: readonly Question[]) {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const list: SessionAnswer[] = result.questionIds.flatMap((id) => {
    const q = byId.get(id)
    const sel = result.answers[id]
    return q && sel ? [{ questionId: id, topicId: q.topicId, subjectId: q.subjectId, difficulty: q.difficulty, selectedOptionId: sel, isCorrect: sel === q.correctOptionId, timeMs: 0 }] : []
  })
  return summarize(list, result.total)
}
