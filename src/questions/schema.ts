import { z } from 'zod'
import { normName } from '../workspace/model'

/**
 * The question contract (v3.0 Phase 4). It mirrors the database check `public.valid_question_payload`
 * rule for rule; `src/questions/contract-fixtures.json` is run through BOTH, so they cannot drift apart.
 */
export const QUESTION_TYPES = ['SBA', 'MULTIPLE_MCQ', 'TRUE_FALSE', 'FILL_GAP'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const MAX_STEM = 10000
export const MAX_EXPLANATION = 20000
export const MAX_REFERENCE = 2000
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 12
export const MAX_BLANKS = 20
export const MAX_ANSWERS_PER_BLANK = 20

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const id = z.string().regex(ID_RE, 'Ids use letters, digits, - or _ (up to 40 characters).')
const negativeMarks = z.number().min(0, 'Negative marks must be between 0 and 1.').max(1, 'Negative marks must be between 0 and 1.')

const option = z.strictObject({
  id,
  text: z.string().trim().min(1, 'Every option needs text.').max(2000, 'Keep an option to 2000 characters or fewer.'),
  explanation: z.string().max(4000, 'Keep an option explanation to 4000 characters or fewer.').optional(),
})
const options = z.array(option).min(MIN_OPTIONS, `Add at least ${MIN_OPTIONS} options.`).max(MAX_OPTIONS, `Use at most ${MAX_OPTIONS} options.`).superRefine((list, ctx) => {
  const ids = new Set<string>()
  const texts = new Set<string>()
  list.forEach((o, i) => {
    if (ids.has(o.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Two options share an id.' })
    ids.add(o.id)
    const key = normName(o.text)
    if (texts.has(key)) ctx.addIssue({ code: 'custom', path: [i, 'text'], message: 'Two options have the same text.' })
    texts.add(key)
  })
})

export const SbaContentSchema = z
  .strictObject({ options, correct_option_id: id, scoring: z.strictObject({ negative_marks: negativeMarks.optional() }).optional() })
  .superRefine((c, ctx) => {
    if (!c.options.some((o) => o.id === c.correct_option_id)) ctx.addIssue({ code: 'custom', path: ['correct_option_id'], message: 'Choose the correct option.' })
  })

export const MultipleContentSchema = z
  .strictObject({
    options,
    correct_option_ids: z.array(id),
    scoring: z
      .strictObject({
        mode: z.enum(['exact', 'partial']).optional(),
        penalty_weight: z.number().min(0, 'Penalty weight must be between 0 and 5.').max(5, 'Penalty weight must be between 0 and 5.').optional(),
        negative_marks: negativeMarks.optional(),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    const ids = new Set(c.options.map((o) => o.id))
    if (c.correct_option_ids.length < 2) ctx.addIssue({ code: 'custom', path: ['correct_option_ids'], message: 'Choose at least 2 correct options (use a single-answer question for one).' })
    if (c.correct_option_ids.length > c.options.length) ctx.addIssue({ code: 'custom', path: ['correct_option_ids'], message: 'More correct answers than options.' })
    const seen = new Set<string>()
    for (const x of c.correct_option_ids) {
      if (!ids.has(x) || seen.has(x)) ctx.addIssue({ code: 'custom', path: ['correct_option_ids'], message: 'A correct answer is not one of the options.' })
      seen.add(x)
    }
  })

export const TrueFalseContentSchema = z.strictObject({
  correct_answer: z.boolean('Choose True or False.'),
  scoring: z.strictObject({ negative_marks: negativeMarks.optional() }).optional(),
})

const blank = z.strictObject({
  id,
  accepted_answers: z
    .array(z.string().trim().min(1, 'An accepted answer cannot be empty.').max(200, 'Keep an accepted answer to 200 characters or fewer.'))
    .min(1, 'Each blank needs at least one accepted answer.')
    .max(MAX_ANSWERS_PER_BLANK, `Use at most ${MAX_ANSWERS_PER_BLANK} accepted answers per blank.`),
  case_sensitive: z.boolean().optional(),
})
export const FillGapContentSchema = z.strictObject({
  blanks: z.array(blank).min(1, 'Add at least one blank.').max(MAX_BLANKS, `Use at most ${MAX_BLANKS} blanks.`).superRefine((list, ctx) => {
    const ids = new Set<string>()
    list.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Two blanks share an id.' })
      ids.add(b.id)
    })
  }),
  normalization: z.strictObject({ case_sensitive: z.boolean().optional(), strip_punctuation: z.boolean().optional() }).optional(),
  scoring: z.strictObject({ mode: z.enum(['partial', 'all_or_nothing']).optional() }).optional(),
})

const SCHEMAS = { SBA: SbaContentSchema, MULTIPLE_MCQ: MultipleContentSchema, TRUE_FALSE: TrueFalseContentSchema, FILL_GAP: FillGapContentSchema } as const

export type SbaContent = z.infer<typeof SbaContentSchema>
export type MultipleContent = z.infer<typeof MultipleContentSchema>
export type TrueFalseContent = z.infer<typeof TrueFalseContentSchema>
export type FillGapContent = z.infer<typeof FillGapContentSchema>
export type QuestionContent = SbaContent | MultipleContent | TrueFalseContent | FillGapContent
export type ContentOf<T extends QuestionType> = T extends 'SBA' ? SbaContent : T extends 'MULTIPLE_MCQ' ? MultipleContent : T extends 'TRUE_FALSE' ? TrueFalseContent : FillGapContent

export const contentSchema = (t: QuestionType) => SCHEMAS[t]

export interface Problem { path: string; message: string }
export type Validated = { ok: true; stem: string; content: QuestionContent } | { ok: false; problems: Problem[] }

/** Marker for a blank inside a fill-in-the-gap stem, for example `The {{b1}} pumps blood`. */
export const BLANK_MARKER = /\{\{([A-Za-z0-9_-]{1,40})\}\}/g
export const blankMarkers = (stem: string): string[] => [...stem.matchAll(BLANK_MARKER)].map((m) => m[1])

/** An option explanation that is only spaces is the same as none: remove it so it is never saved. */
function dropBlankExplanations(content: unknown): unknown {
  const c = content as { options?: unknown }
  if (!c || typeof c !== 'object' || !Array.isArray(c.options)) return content
  return { ...c, options: c.options.map((o) => { if (o && typeof o === 'object' && 'explanation' in o && !String((o as { explanation: unknown }).explanation ?? '').trim()) { const { explanation: _e, ...rest } = o as Record<string, unknown>; void _e; return rest } return o }) }
}

/** Checks the type-specific part of a question (the same rules as the database). Returns cleaned content on success. */
export function validateQuestion(type: QuestionType, stem: string, content: unknown): Validated {
  const problems: Problem[] = []
  const s = z.string().trim().min(1, 'Write the question.').max(MAX_STEM, `Keep the question to ${MAX_STEM} characters or fewer.`).safeParse(stem)
  if (!s.success) problems.push({ path: 'stem', message: s.error.issues[0].message })
  const parsed = contentSchema(type).safeParse(dropBlankExplanations(content))
  if (!parsed.success) for (const i of parsed.error.issues) problems.push({ path: i.path.join('.'), message: i.message })
  if (type === 'FILL_GAP' && parsed.success) {
    const c = parsed.data as FillGapContent
    const have = new Set(c.blanks.map((b) => b.id))
    for (const b of c.blanks) if (!stem.includes(`{{${b.id}}}`)) problems.push({ path: `blanks.${b.id}`, message: `The question does not show where blank "${b.id}" goes.` })
    for (const m of blankMarkers(stem)) if (!have.has(m)) problems.push({ path: 'stem', message: `The question has a blank "${m}" with no accepted answers.` })
  }
  if (problems.length || !s.success || !parsed.success) return { ok: false, problems }
  return { ok: true, stem: s.data, content: parsed.data as QuestionContent }
}
