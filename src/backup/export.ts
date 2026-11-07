import { z } from 'zod'
import { MockResultSchema, type MockResult } from '../mock/mock'
import { AttemptSchema, type Attempt } from '../practice/attempts'
import { FLAG_REASONS, type UserData } from '../userdata/model'

/**
 * A student's own backup file. It holds only what the student created on this account (answers,
 * bookmarks, collections, notes, reports, finished mock exams, settings) - no email, no password, no
 * identifiers of the account - and a SHA-256 checksum so a damaged or edited file is detected.
 */
export const EXPORT_FORMAT = 'shuvromed-export'
export const EXPORT_VERSION = 1
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

const Iso = z.iso.datetime({ offset: true })
const QuestionId = z.string().min(1).max(100)

export const ExportDataSchema = z.strictObject({
  attempts: z.array(AttemptSchema).max(500_000),
  collections: z.array(z.strictObject({ id: z.uuid(), name: z.string().min(1).max(60), createdAt: Iso })).max(1000),
  bookmarks: z.array(z.strictObject({ questionId: QuestionId, collectionId: z.uuid().nullable(), createdAt: Iso })).max(100_000),
  notes: z.array(z.strictObject({ questionId: QuestionId, body: z.string().min(1).max(5000), updatedAt: Iso })).max(100_000),
  flags: z.array(z.strictObject({ questionId: QuestionId, reason: z.enum(FLAG_REASONS), comment: z.string().max(1000).nullable(), createdAt: Iso })).max(100_000),
  mockResults: z.array(MockResultSchema).max(100),
  settings: z.strictObject({ dailyGoal: z.number().int().min(1).max(500).optional(), gamification: z.boolean().optional() }),
})
export type ExportData = z.infer<typeof ExportDataSchema>

export const ExportFileSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: Iso,
  app: z.string().max(60),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  data: ExportDataSchema,
})
export type ExportFile = z.infer<typeof ExportFileSchema>

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ExportSource {
  attempts: readonly Attempt[]
  userData: UserData
  mockResults: readonly MockResult[]
  settings: { dailyGoal?: number; gamification?: boolean }
}

/** Collects the student's data in a fixed, sorted order so the same data always gives the same file. */
export function collectData(src: ExportSource): ExportData {
  const byTime = (a: Attempt, b: Attempt) => (a.attemptedAt === b.attemptedAt ? a.id.localeCompare(b.id) : a.attemptedAt < b.attemptedAt ? -1 : 1)
  return {
    attempts: [...src.attempts].sort(byTime),
    collections: [...src.userData.collections].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt })),
    bookmarks: [...src.userData.bookmarks].sort((a, b) => a.questionId.localeCompare(b.questionId)).map((b) => ({ questionId: b.questionId, collectionId: b.collectionId, createdAt: b.createdAt })),
    notes: [...src.userData.notes].sort((a, b) => a.questionId.localeCompare(b.questionId)).map((n) => ({ questionId: n.questionId, body: n.body, updatedAt: n.updatedAt })),
    flags: [...src.userData.flags].sort((a, b) => (a.questionId + a.reason).localeCompare(b.questionId + b.reason)).map((f) => ({ questionId: f.questionId, reason: f.reason, comment: f.comment, createdAt: f.createdAt })),
    mockResults: [...src.mockResults].sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1)),
    settings: src.settings,
  }
}

export async function buildExport(src: ExportSource, now: Date = new Date(), app = 'ShuvroMed'): Promise<ExportFile> {
  const data = ExportDataSchema.parse(collectData(src)) // never write a file we could not read back
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), app, checksum: await sha256Hex(JSON.stringify(data)), data }
}

export const exportToText = (f: ExportFile): string => JSON.stringify(f)

const csvCell = (v: string | number | boolean | undefined): string => {
  const s = v === undefined ? '' : String(v)
  // Spreadsheet apps run text that begins with = + - @ as a formula; a leading apostrophe stops that.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function attemptsToCsv(attempts: readonly Attempt[]): string {
  const head = ['attempted_at', 'question_id', 'selected_option', 'is_correct', 'confidence', 'time_seconds', 'mode']
  const rows = [...attempts]
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : a.attemptedAt > b.attemptedAt ? 1 : a.id.localeCompare(b.id)))
    .map((a) => [a.attemptedAt, a.questionId, a.selectedOptionId, a.isCorrect, a.confidence, Math.round(a.timeMs / 100) / 10, a.mode].map(csvCell).join(','))
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

export function exportFileName(now: Date, ext: 'json' | 'csv'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `shuvromed-${ext === 'json' ? 'backup' : 'answers'}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.${ext}`
}
