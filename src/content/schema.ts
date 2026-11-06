import { z } from 'zod'

/**
 * Content schemas. Single source of truth for the app, the CLI validator and the importer.
 * Patterns and enums deliberately mirror the database constraints in supabase/migrations,
 * so content that validates here can later be seeded into the catalogue tables unchanged.
 */

export const OPTION_IDS = ['A', 'B', 'C', 'D', 'E'] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export const QUESTION_STATUSES = ['draft', 'needs_review', 'approved', 'published', 'archived'] as const
export const REFERENCE_KINDS = ['textbook', 'guideline', 'article', 'website', 'other'] as const

const subjectId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'must be lowercase letters, digits and hyphens (2-49 chars)')
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/, 'must be lowercase letters, digits and hyphens (2-81 chars)')
const shortSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'must be lowercase letters, digits and hyphens (2-40 chars)')
const questionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/, 'must be 3-81 chars: letters, digits, dot, underscore, hyphen')
const text = (min: number, max: number) => z.string().trim().min(min).max(max)

export const OptionIdSchema = z.enum(OPTION_IDS)
export const DifficultySchema = z.enum(DIFFICULTIES)
export const QuestionStatusSchema = z.enum(QUESTION_STATUSES)

export const SubjectSchema = z.strictObject({
  id: subjectId,
  name: text(1, 120),
  description: text(1, 500).optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
})

export const TopicSchema = z.strictObject({
  id: slug,
  subjectId,
  parentId: slug.nullable().default(null),
  name: text(1, 160),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
})

/** Exam styles are data: add a row to content/exam-styles.json, no code change. */
export const ExamStyleSchema = z.strictObject({
  id: shortSlug,
  name: text(1, 80),
  description: text(1, 300).optional(),
})

/** Question formats are data too. Option counts here are enforced against every question. */
export const QuestionFormatSchema = z
  .strictObject({
    id: shortSlug,
    name: text(1, 120),
    minOptions: z.number().int().min(2).max(OPTION_IDS.length),
    maxOptions: z.number().int().min(2).max(OPTION_IDS.length),
  })
  .refine((f) => f.minOptions <= f.maxOptions, { message: 'minOptions must be <= maxOptions', path: ['minOptions'] })

export const ReferenceSchema = z.strictObject({
  kind: z.enum(REFERENCE_KINDS).default('other'),
  title: text(1, 300),
  edition: text(1, 40).optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  pages: text(1, 40).optional(),
  url: z
    .url()
    .refine((u) => /^https?:\/\//i.test(u), { message: 'url must start with http:// or https://' })
    .optional(),
})

const isoDate = z.iso.datetime({ offset: true })

export const QuestionSchema = z
  .strictObject({
    id: questionId,
    version: z.number().int().min(1).default(1),
    status: QuestionStatusSchema.default('draft'),
    /** True until the owner has reviewed and approved the content. Unreviewed content can never be published. */
    unreviewed: z.boolean().default(true),
    /** Demo content is shown only with a visible DEMO label and can never be published. */
    isDemo: z.boolean().default(false),
    subjectId,
    topicId: slug,
    difficulty: DifficultySchema,
    format: shortSlug,
    examTags: z.array(shortSlug).min(1).max(10),
    stem: text(10, 4000),
    options: z.array(z.strictObject({ id: OptionIdSchema, text: text(1, 1000) })).min(2).max(OPTION_IDS.length),
    correctOptionId: OptionIdSchema,
    explanation: text(1, 8000),
    optionAnalysis: z.record(z.string(), text(1, 2000)),
    clinicalPearl: text(1, 1000).optional(),
    references: z.array(ReferenceSchema).max(20).default([]),
    learningObjectives: z.array(text(1, 300)).max(10).default([]),
    /** Set true for options like "All of the above" that must keep their written order. */
    fixedOptionOrder: z.boolean().default(false),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .superRefine((q, ctx) => {
    const fail = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

    const ids = q.options.map((o) => o.id)
    if (new Set(ids).size !== ids.length) fail('option ids must be unique', ['options'])
    const expected = OPTION_IDS.slice(0, ids.length)
    if (ids.some((id, i) => id !== expected[i])) {
      fail(`option ids must run in order starting at A (expected ${expected.join(', ')})`, ['options'])
    }
    const texts = q.options.map((o) => o.text.toLowerCase().replace(/\s+/g, ' '))
    if (new Set(texts).size !== texts.length) fail('two options have identical text', ['options'])

    if (!ids.includes(q.correctOptionId)) fail('correctOptionId is not one of the options', ['correctOptionId'])

    const analysisKeys = Object.keys(q.optionAnalysis).sort()
    const sortedIds = [...ids].sort()
    if (analysisKeys.join() !== sortedIds.join()) {
      fail(`optionAnalysis must have exactly one entry per option (${sortedIds.join(', ')})`, ['optionAnalysis'])
    }

    if (new Set(q.examTags).size !== q.examTags.length) fail('examTags contains duplicates', ['examTags'])

    if (q.status === 'published') {
      if (q.unreviewed) fail('a question marked unreviewed cannot be published', ['status'])
      if (q.isDemo) fail('demo questions cannot be published', ['status'])
      if (q.references.length === 0) fail('a published question needs at least one reference', ['references'])
    }

    if (Date.parse(q.updatedAt) < Date.parse(q.createdAt)) fail('updatedAt is earlier than createdAt', ['updatedAt'])
  })

export type Subject = z.infer<typeof SubjectSchema>
export type Topic = z.infer<typeof TopicSchema>
export type ExamStyle = z.infer<typeof ExamStyleSchema>
export type QuestionFormat = z.infer<typeof QuestionFormatSchema>
export type Reference = z.infer<typeof ReferenceSchema>
export type Question = z.infer<typeof QuestionSchema>
export type OptionId = z.infer<typeof OptionIdSchema>
export type Difficulty = z.infer<typeof DifficultySchema>
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>
