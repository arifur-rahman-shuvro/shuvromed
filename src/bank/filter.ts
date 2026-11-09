import { z } from 'zod'
import { searchText } from '../questions/registry'
import type { WQuestion } from '../questions/repo'
import { DIFFICULTIES, QUESTION_TYPES, type Difficulty, type QuestionType } from '../questions/schema'
import type { WTag } from '../tags/repo'
import { descendantIds, type WTopic } from '../workspace/model'

export type DifficultyChoice = Difficulty | 'none'
export type StateChoice = 'active' | 'archived' | 'all'
export type SortChoice = 'edited-new' | 'edited-old' | 'wording'
export type UniversalChoice = 'any' | 'only' | 'exam'

/**
 * Everything a person can narrow the bank by. Inside one group the choices are OR ("Anatomy or Physiology");
 * different groups are AND ("Anatomy AND hard"). An empty group does not filter.
 */
export interface BankFilter {
  text: string
  subjectIds: string[]
  /** A topic includes its sub-topics. */
  topicIds: string[]
  /** Only questions with no topic at all. */
  noTopic: boolean
  types: QuestionType[]
  examTagIds: string[]
  generalTagIds: string[]
  /** `only`: no exam tag (Universal). `exam`: at least one exam tag. */
  universal: UniversalChoice
  /** Only questions with no tag at all (handy for quick classifying). */
  noTags: boolean
  difficulties: DifficultyChoice[]
  state: StateChoice
}

export const EMPTY_FILTER: BankFilter = {
  text: '', subjectIds: [], topicIds: [], noTopic: false, types: [], examTagIds: [], generalTagIds: [], universal: 'any', noTags: false, difficulties: [], state: 'active',
}

/** Reads a saved filter back, tolerating a missing or unknown field (a newer app may have saved more). Never throws. */
const SavedShape = z.object({
  text: z.string().max(500).catch(''),
  subjectIds: z.array(z.string()).max(500).catch([]),
  topicIds: z.array(z.string()).max(1000).catch([]),
  noTopic: z.boolean().catch(false),
  types: z.array(z.enum(QUESTION_TYPES)).catch([]),
  examTagIds: z.array(z.string()).max(500).catch([]),
  generalTagIds: z.array(z.string()).max(500).catch([]),
  universal: z.enum(['any', 'only', 'exam']).catch('any'),
  noTags: z.boolean().catch(false),
  difficulties: z.array(z.enum([...DIFFICULTIES, 'none'])).catch([]),
  state: z.enum(['active', 'archived', 'all']).catch('active'),
})
export function parseFilter(raw: unknown): BankFilter {
  const p = SavedShape.safeParse(raw && typeof raw === 'object' ? raw : {})
  return p.success ? (p.data as BankFilter) : { ...EMPTY_FILTER }
}

/** How many groups are narrowing the list (shown on the Filters button). */
export function activeFilterCount(f: BankFilter): number {
  return [
    f.text.trim() !== '', f.subjectIds.length > 0, f.topicIds.length > 0, f.noTopic, f.types.length > 0, f.examTagIds.length > 0, f.generalTagIds.length > 0,
    f.universal !== 'any', f.noTags, f.difficulties.length > 0, f.state !== 'active',
  ].filter(Boolean).length
}
export const isDefaultFilter = (f: BankFilter): boolean => activeFilterCount(f) === 0

const fold = (s: string): string => s.normalize('NFKC').toLowerCase()
/** Words to look for. Quoted text is kept together: `"left atrium" valve`. */
export function searchTerms(text: string): string[] {
  const terms: string[] = []
  for (const m of fold(text).matchAll(/"([^"]+)"|(\S+)/g)) { const t = (m[1] ?? m[2]).trim().replace(/\s+/g, ' '); if (t) terms.push(t) }
  return terms
}

/** Search text for each question, built once per question version so typing in the search box stays fast on thousands of questions. */
export function buildSearchIndex(questions: WQuestion[], previous?: Map<string, { key: string; text: string }>): Map<string, { key: string; text: string }> {
  const out = new Map<string, { key: string; text: string }>()
  for (const q of questions) {
    const key = `${q.updatedAt}|${q.version ?? ''}|${q.stem.length}`
    const old = previous?.get(q.id)
    out.set(q.id, old && old.key === key ? old : { key, text: fold(searchText({ question_type: q.type, stem: q.stem, content: q.content, explanation: q.explanation, reference: q.reference })) })
  }
  return out
}

export interface FilterContext {
  topics: WTopic[]
  tags: Pick<WTag, 'id' | 'category'>[]
  index: Map<string, { text: string }>
}

export function applyFilter(questions: WQuestion[], f: BankFilter, ctx: FilterContext): WQuestion[] {
  const terms = searchTerms(f.text)
  const subjects = new Set(f.subjectIds)
  const topics = new Set(f.topicIds.flatMap((id) => [id, ...descendantIds(ctx.topics, id)]))
  const types = new Set<QuestionType>(f.types)
  const exam = new Set(f.examTagIds)
  const general = new Set(f.generalTagIds)
  const diffs = new Set<DifficultyChoice>(f.difficulties)
  const examIds = new Set(ctx.tags.filter((t) => t.category === 'exam').map((t) => t.id))
  return questions.filter((q) => {
    if (q.deleted) return false
    if (f.state === 'active' && q.archived) return false
    if (f.state === 'archived' && !q.archived) return false
    if (subjects.size && !subjects.has(q.subjectId)) return false
    if (types.size && !types.has(q.type)) return false
    if (diffs.size && !diffs.has(q.difficulty ?? 'none')) return false
    if (f.noTopic && q.topicIds.length) return false
    if (topics.size && !q.topicIds.some((t) => topics.has(t))) return false
    if (f.noTags && q.tagIds.length) return false
    if (exam.size && !q.tagIds.some((t) => exam.has(t))) return false
    if (general.size && !q.tagIds.some((t) => general.has(t))) return false
    const hasExam = q.tagIds.some((t) => examIds.has(t))
    if (f.universal === 'only' && hasExam) return false
    if (f.universal === 'exam' && !hasExam) return false
    if (terms.length) {
      const hay = ctx.index.get(q.id)?.text ?? ''
      for (const t of terms) if (!hay.includes(t)) return false
    }
    return true
  })
}

export function sortQuestions(list: WQuestion[], sort: SortChoice): WQuestion[] {
  const out = [...list]
  if (sort === 'wording') out.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id))
  else if (sort === 'edited-old') out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
  else out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return out
}
