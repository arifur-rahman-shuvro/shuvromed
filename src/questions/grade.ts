import type { FillGapContent, MultipleContent, QuestionContent, QuestionType, SbaContent, TrueFalseContent } from './schema'

/** Every question is worth at most 1 mark. Scores are rounded to 4 decimals (the database column is numeric(8,4)). */
export interface QuestionLike { question_type: QuestionType; stem: string; content: QuestionContent }
export type Outcome = 'correct' | 'partial' | 'incorrect' | 'unanswered'
export interface BlankDetail { id: string; given: string; ok: boolean; accepted: string[] }
export interface GradeResult {
  score: number
  max: 1
  outcome: Outcome
  /** Type-specific facts for showing feedback. */
  detail:
    | { type: 'SBA'; selected: string | null; correct: string }
    | { type: 'MULTIPLE_MCQ'; selected: string[]; correct: string[]; right: number; wrong: number; missed: number }
    | { type: 'TRUE_FALSE'; value: boolean | null; correct: boolean }
    | { type: 'FILL_GAP'; blanks: BlankDetail[] }
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000 || 0 // `|| 0` turns -0 into 0
const outcomeOf = (score: number, answered: boolean): Outcome => (!answered ? 'unanswered' : score >= 1 - 1e-9 ? 'correct' : score > 0 ? 'partial' : 'incorrect')
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})

/** How a typed answer is compared: Unicode NFKC, trimmed, spaces collapsed, case folded (unless case-sensitive), optional punctuation removal. */
export function normalizeAnswer(s: string, o: { caseSensitive?: boolean; stripPunctuation?: boolean } = {}): string {
  let t = s.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (o.stripPunctuation) t = t.replace(/\p{P}/gu, '').replace(/\s+/g, ' ').trim()
  return o.caseSensitive ? t : t.toLowerCase()
}

/**
 * Response shapes (stored as JSON with each attempt):
 *  SBA `{selected: "a"}` · MULTIPLE_MCQ `{selected: ["a","c"]}` · TRUE_FALSE `{value: true}` · FILL_GAP `{answers: {"b1": "heart"}}`
 */
export function grade(q: QuestionLike, response: unknown): GradeResult {
  const res = obj(response)
  switch (q.question_type) {
    case 'SBA': return gradeSba(q.content as SbaContent, res)
    case 'MULTIPLE_MCQ': return gradeMultiple(q.content as MultipleContent, res)
    case 'TRUE_FALSE': return gradeTrueFalse(q.content as TrueFalseContent, res)
    case 'FILL_GAP': return gradeFill(q.content as FillGapContent, res)
  }
}

function gradeSba(c: SbaContent, res: Record<string, unknown>): GradeResult {
  const selected = typeof res.selected === 'string' && res.selected ? res.selected : null
  const neg = c.scoring?.negative_marks ?? 0
  const score = selected === null ? 0 : selected === c.correct_option_id ? 1 : -neg
  return { score: r4(score), max: 1, outcome: outcomeOf(score, selected !== null), detail: { type: 'SBA', selected, correct: c.correct_option_id } }
}

function gradeMultiple(c: MultipleContent, res: Record<string, unknown>): GradeResult {
  const valid = new Set(c.options.map((o) => o.id))
  const selected = [...new Set(Array.isArray(res.selected) ? res.selected.filter((x): x is string => typeof x === 'string' && valid.has(x)) : [])]
  const correct = new Set(c.correct_option_ids)
  const right = selected.filter((x) => correct.has(x)).length
  const wrong = selected.length - right
  const missed = correct.size - right
  const neg = c.scoring?.negative_marks ?? 0
  const mode = c.scoring?.mode ?? 'exact'
  const w = c.scoring?.penalty_weight ?? 1
  let score: number
  if (selected.length === 0) score = 0
  else if (mode === 'partial') {
    const raw = Math.min(1, Math.max(0, (right - wrong * w) / correct.size))
    score = raw > 0 ? raw : -neg
  } else score = wrong === 0 && missed === 0 ? 1 : -neg
  return { score: r4(score), max: 1, outcome: outcomeOf(score, selected.length > 0), detail: { type: 'MULTIPLE_MCQ', selected, correct: c.correct_option_ids, right, wrong, missed } }
}

function gradeTrueFalse(c: TrueFalseContent, res: Record<string, unknown>): GradeResult {
  const value = typeof res.value === 'boolean' ? res.value : null
  const neg = c.scoring?.negative_marks ?? 0
  const score = value === null ? 0 : value === c.correct_answer ? 1 : -neg
  return { score: r4(score), max: 1, outcome: outcomeOf(score, value !== null), detail: { type: 'TRUE_FALSE', value, correct: c.correct_answer } }
}

function gradeFill(c: FillGapContent, res: Record<string, unknown>): GradeResult {
  const answers = obj(res.answers)
  const blanks: BlankDetail[] = c.blanks.map((b) => {
    const given = typeof answers[b.id] === 'string' ? (answers[b.id] as string) : ''
    const o = { caseSensitive: b.case_sensitive ?? c.normalization?.case_sensitive ?? false, stripPunctuation: c.normalization?.strip_punctuation ?? false }
    const g = normalizeAnswer(given, o)
    return { id: b.id, given, ok: g !== '' && b.accepted_answers.some((a) => normalizeAnswer(a, o) === g), accepted: b.accepted_answers }
  })
  const answered = blanks.some((b) => b.given.trim() !== '')
  const okCount = blanks.filter((b) => b.ok).length
  const score = (c.scoring?.mode ?? 'partial') === 'all_or_nothing' ? (okCount === blanks.length ? 1 : 0) : okCount / blanks.length
  return { score: r4(score), max: 1, outcome: outcomeOf(score, answered), detail: { type: 'FILL_GAP', blanks } }
}
