import { z } from 'zod'
import { DIFFICULTIES, QUESTION_TYPES, type Difficulty } from '../questions/schema'
import type { QuestionContent, QuestionType } from '../questions/schema'
import { FILE_FORMAT, FILE_VERSION, type ImportItem, type ReadResult } from './types'

const str = (max: number) => z.string().max(max)
const FileQuestion = z.object({
  subject: str(200),
  topics: z.array(z.array(str(200)).min(1)).max(60).optional(),
  exam_tags: z.array(str(200)).max(60).optional(),
  tags: z.array(str(200)).max(60).optional(),
  type: z.enum(QUESTION_TYPES),
  stem: z.string(),
  content: z.unknown(),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  explanation: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
})

export interface FileQuestionOut {
  subject: string
  topics: string[][]
  exam_tags: string[]
  tags: string[]
  type: QuestionType
  stem: string
  content: QuestionContent
  difficulty: Difficulty | null
  explanation: string | null
  reference: string | null
}
export interface QuestionFile { format: typeof FILE_FORMAT; version: number; exported_at: string; questions: FileQuestionOut[] }

/** Reads the JSON file format. A bad question is reported and skipped; the rest are still read. */
export function readJsonFile(text: string): ReadResult {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { items: [], failures: [], fatal: 'This is not a valid JSON file.' } }
  const obj = raw as { format?: unknown; version?: unknown; questions?: unknown }
  const list = Array.isArray(raw) ? raw : obj && typeof obj === 'object' ? obj.questions : undefined
  if (!Array.isArray(raw)) {
    if (obj?.format !== FILE_FORMAT) return { items: [], failures: [], fatal: `This file is not a ShuvroMed question file (expected format "${FILE_FORMAT}").` }
    if (typeof obj.version !== 'number' || obj.version > FILE_VERSION) return { items: [], failures: [], fatal: 'This file comes from a newer version of ShuvroMed. Update the app and try again.' }
  }
  if (!Array.isArray(list)) return { items: [], failures: [], fatal: 'The file has no list of questions.' }
  const out: ReadResult = { items: [], failures: [], fatal: null }
  list.forEach((entry, i) => {
    const label = `Question ${i + 1}`
    const p = FileQuestion.safeParse(entry)
    if (!p.success) { out.failures.push({ label, problems: p.error.issues.slice(0, 3).map((x) => `${x.path.join('.') || 'question'}: ${x.message}`) }); return }
    const q = p.data
    const item: ImportItem = {
      subject: q.subject, topics: q.topics ?? [], examTags: q.exam_tags ?? [], generalTags: q.tags ?? [], type: q.type, stem: q.stem,
      difficulty: q.difficulty ?? null, content: q.content as QuestionContent, explanation: q.explanation ?? null, reference: q.reference ?? null,
    }
    out.items.push({ label, item })
  })
  return out
}
