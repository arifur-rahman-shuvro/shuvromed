import { EMPTY_FILTER, parseFilter, type BankFilter } from '../bank/filter'
import type { Outcome } from '../questions/grade'
import type { Response } from '../questions/ui/QuestionView'

export type SessionKind = 'practice' | 'exam'
export const MAX_SESSION_QUESTIONS = 500
export const MAX_TIME_MINUTES = 1440

/** How one practice run or exam is set up. Saved with the session, so a past session always shows how it was run. */
export interface SessionConfig {
  mode: SessionKind
  /** How many questions were asked (1 to 500). */
  count: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  /** Practice shows the answer after each question; an exam shows nothing until you submit. */
  feedback: 'immediate' | 'end'
  /** Exam only. Time that has passed while the app was open counts; the clock pauses while it is closed. */
  timeLimitMinutes: number | null
  /** Off: a wrong answer scores 0 instead of losing marks. Marks lost per question are set in each question. */
  negativeMarking: boolean
  /** The bank filter the questions were chosen from, and its plain-words description. */
  filter: BankFilter
  sourceLabel: string
  /** Fixes the shuffle, so reviewing a session shows the same order. */
  seed: number
}

export const DEFAULT_CONFIG: SessionConfig = {
  mode: 'practice', count: 20, shuffleQuestions: true, shuffleOptions: false, feedback: 'immediate',
  timeLimitMinutes: null, negativeMarking: true, filter: EMPTY_FILTER, sourceLabel: 'All my questions', seed: 1,
}

const int = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d)
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d)

/** Reads a saved config defensively: anything missing or odd falls back to the default. */
export function parseConfig(raw: unknown): SessionConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mode: SessionKind = o.mode === 'exam' ? 'exam' : 'practice'
  const tl = o.timeLimitMinutes
  return {
    mode,
    count: int(o.count, 1, MAX_SESSION_QUESTIONS, DEFAULT_CONFIG.count),
    shuffleQuestions: bool(o.shuffleQuestions, true),
    shuffleOptions: bool(o.shuffleOptions, false),
    feedback: mode === 'exam' ? 'end' : o.feedback === 'end' ? 'end' : 'immediate',
    timeLimitMinutes: mode === 'exam' && typeof tl === 'number' && tl >= 1 ? int(tl, 1, MAX_TIME_MINUTES, 60) : null,
    negativeMarking: bool(o.negativeMarking, true),
    filter: parseFilter(o.filter),
    sourceLabel: typeof o.sourceLabel === 'string' ? o.sourceLabel.slice(0, 200) : DEFAULT_CONFIG.sourceLabel,
    seed: int(o.seed, 0, 2147483647, 1),
  }
}

/** What the learner has done so far in one question of a session. */
export interface AnswerRecord {
  response: Response | null
  flagged?: boolean
  /** Time spent on this question, in milliseconds. */
  ms: number
  /** Set once the answer has been checked (practice) or submitted (exam). */
  score?: number
  outcome?: Outcome
}
export interface SessionState { index: number; answers: Record<string, AnswerRecord> }

export function parseState(raw: unknown, questionCount: number): SessionState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const answers: Record<string, AnswerRecord> = {}
  if (o.answers && typeof o.answers === 'object') {
    for (const [id, a] of Object.entries(o.answers as Record<string, unknown>)) {
      if (!a || typeof a !== 'object') continue
      const r = a as Record<string, unknown>
      answers[id] = {
        response: r.response && typeof r.response === 'object' ? (r.response as Response) : null,
        flagged: r.flagged === true ? true : undefined,
        ms: int(r.ms, 0, 86400000, 0),
        score: typeof r.score === 'number' ? r.score : undefined,
        outcome: r.outcome === 'correct' || r.outcome === 'partial' || r.outcome === 'incorrect' || r.outcome === 'unanswered' ? r.outcome : undefined,
      }
    }
  }
  return { index: int(o.index, 0, Math.max(0, questionCount - 1), 0), answers }
}
