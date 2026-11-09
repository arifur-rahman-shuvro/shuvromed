import { grade, type GradeResult, type Outcome } from '../questions/grade'
import type { WQuestion } from '../questions/repo'
import type { Response } from '../questions/ui/QuestionView'
import type { AnswerRecord } from './types'

const r4 = (n: number): number => Math.round(n * 10000) / 10000 || 0

export interface Graded { score: number; outcome: Outcome; result: GradeResult }

/** Grades one answer. With negative marking off, a wrong answer scores 0 instead of a negative number. */
export function gradeAnswer(q: Pick<WQuestion, 'type' | 'stem' | 'content'>, response: Response | null, negativeMarking: boolean): Graded {
  const result = grade({ question_type: q.type, stem: q.stem, content: q.content }, response ?? {})
  const score = negativeMarking ? result.score : Math.max(0, result.score)
  return { score: r4(score), outcome: result.outcome, result }
}

export interface Summary {
  score: number
  max: number
  correct: number
  incorrect: number
  partial: number
  unanswered: number
  /** score / max as a percentage, 1 decimal. Can be negative when marks are lost. */
  percent: number
  bySubject: { subjectId: string; correct: number; partial: number; incorrect: number; unanswered: number; total: number; score: number }[]
}

/** Adds up a session. Every question in `questions` counts; one with no graded answer is unanswered. */
export function summarize(questions: Pick<WQuestion, 'id' | 'subjectId'>[], answers: Record<string, AnswerRecord>): Summary {
  const s: Summary = { score: 0, max: questions.length, correct: 0, incorrect: 0, partial: 0, unanswered: 0, percent: 0, bySubject: [] }
  const subj = new Map<string, Summary['bySubject'][number]>()
  for (const q of questions) {
    const a = answers[q.id]
    const outcome: Outcome = a?.outcome ?? 'unanswered'
    const score = outcome === 'unanswered' ? 0 : a?.score ?? 0
    s.score += score
    s[outcome]++
    const b = subj.get(q.subjectId) ?? { subjectId: q.subjectId, correct: 0, partial: 0, incorrect: 0, unanswered: 0, total: 0, score: 0 }
    b[outcome]++; b.total++; b.score = r4(b.score + score)
    subj.set(q.subjectId, b)
  }
  s.score = r4(s.score)
  s.percent = s.max ? Math.round((s.score / s.max) * 1000) / 10 : 0
  s.bySubject = [...subj.values()].sort((a, b) => b.total - a.total)
  return s
}

/** "1h 05m", "12m 30s", "45s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}
/** "01:05:09" style countdown. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}
