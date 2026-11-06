import { OPTION_IDS } from './schema'
import { validateContent, type ContentInput, type Issue, type Report, type Sourced } from './validate'

/**
 * Bulk import. Pure functions only (no file or network access) so the same code backs the CLI
 * today and an owner-only admin page later.
 *
 * Safety rule: an import can NEVER publish. Every imported question arrives as `draft` and
 * `unreviewed`, whatever the file says. The owner reviews, then promotes it deliberately.
 */

export type ImportFormat = 'csv' | 'json'

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += c
  }
  if (inQuotes) throw new Error('unterminated quote: a quoted field is never closed')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

const REQUIRED_COLUMNS = ['id', 'subjectId', 'topicId', 'difficulty', 'format', 'examTags', 'stem', 'optionA', 'optionB', 'correctOptionId', 'explanation']
const KNOWN_COLUMNS = new Set([
  ...REQUIRED_COLUMNS,
  ...OPTION_IDS.map((l) => `option${l}`),
  ...OPTION_IDS.map((l) => `analysis${l}`),
  'clinicalPearl',
  'learningObjectives',
  'references',
  'version',
  'fixedOptionOrder',
])

export const CSV_COLUMNS = [
  'id', 'subjectId', 'topicId', 'difficulty', 'format', 'examTags', 'stem',
  'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'correctOptionId', 'explanation',
  'analysisA', 'analysisB', 'analysisC', 'analysisD', 'analysisE',
  'clinicalPearl', 'learningObjectives', 'references',
]

const issue = (severity: Issue['severity'], code: string, source: string, message: string, id?: string): Issue => ({ severity, code, source, message, id })
const splitList = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean)

/** Turns CSV text into plain question objects (not yet validated). Problems become issues. */
export function csvToRecords(text: string, label: string): { records: Sourced[]; issues: Issue[] } {
  const issues: Issue[] = []
  let rows: string[][]
  try {
    rows = parseCsv(text)
  } catch (e) {
    return { records: [], issues: [issue('error', 'csv-parse', label, (e as Error).message)] }
  }
  if (rows.length === 0) return { records: [], issues: [issue('error', 'empty-file', label, 'the file has no rows')] }

  const header = rows[0].map((h) => h.trim())
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) {
    return { records: [], issues: [issue('error', 'missing-column', label, `required column(s) missing: ${missing.join(', ')}`)] }
  }
  for (const h of header) if (!KNOWN_COLUMNS.has(h)) issues.push(issue('warning', 'unknown-column', label, `column "${h}" is not used and was ignored`))

  const records: Sourced[] = []
  rows.slice(1).forEach((cells, idx) => {
    const source = `${label}[row ${idx + 2}]`
    const get = (col: string) => (cells[header.indexOf(col)] ?? '').trim()
    const q: Record<string, unknown> = {
      id: get('id'),
      subjectId: get('subjectId').toLowerCase(),
      topicId: get('topicId').toLowerCase(),
      difficulty: get('difficulty').toLowerCase(),
      format: get('format').toLowerCase(),
      examTags: splitList(get('examTags').toLowerCase(), /[;,]/),
      stem: get('stem'),
      options: OPTION_IDS.flatMap((l) => (get(`option${l}`) ? [{ id: l, text: get(`option${l}`) }] : [])),
      correctOptionId: get('correctOptionId').toUpperCase(),
      explanation: get('explanation'),
      optionAnalysis: Object.fromEntries(OPTION_IDS.flatMap((l) => (get(`analysis${l}`) ? [[l, get(`analysis${l}`)]] : []))),
    }
    if (get('clinicalPearl')) q.clinicalPearl = get('clinicalPearl')
    if (get('learningObjectives')) q.learningObjectives = splitList(get('learningObjectives'), /[;\n]/)
    if (get('version')) q.version = Number(get('version'))
    if (get('fixedOptionOrder')) q.fixedOptionOrder = ['true', 'yes', '1'].includes(get('fixedOptionOrder').toLowerCase())
    if (get('references')) {
      try {
        q.references = JSON.parse(get('references'))
      } catch {
        issues.push(issue('error', 'bad-references-json', source, 'the references cell is not valid JSON (expected a JSON array)', get('id') || undefined))
      }
    }
    records.push({ source, data: q })
  })
  return { records, issues }
}

export function jsonToRecords(text: string, label: string): { records: Sourced[]; issues: Issue[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { records: [], issues: [issue('error', 'json-parse', label, `invalid JSON: ${(e as Error).message}`)] }
  }
  if (!Array.isArray(parsed)) return { records: [], issues: [issue('error', 'not-array', label, 'the file must contain a JSON array of questions')] }
  return { records: parsed.map((data, i) => ({ source: `${label}[${i}]`, data })), issues: [] }
}

/**
 * Applies the import safety rules to each record. Anything claiming to be reviewed or published
 * is reset, with a warning, so reviewed status can only be granted by a deliberate later edit.
 */
export function applySafeDefaults(records: Sourced[], now: string): { records: Sourced[]; issues: Issue[] } {
  const issues: Issue[] = []
  const out = records.map((r) => {
    if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return r
    const d = { ...(r.data as Record<string, unknown>) }
    const id = typeof d.id === 'string' ? d.id : undefined
    if (d.status !== undefined && d.status !== 'draft') {
      issues.push(issue('warning', 'status-reset', r.source, `status "${String(d.status)}" was ignored: imported questions always arrive as draft`, id))
    }
    if (d.unreviewed === false) {
      issues.push(issue('warning', 'review-flag-reset', r.source, 'unreviewed=false was ignored: imported questions always arrive as unreviewed', id))
    }
    d.status = 'draft'
    d.unreviewed = true
    d.createdAt ??= now
    d.updatedAt ??= now
    return { source: r.source, data: d }
  })
  return { records: out, issues }
}

export interface ImportResult {
  /** True only when the file parsed and the WHOLE content set (existing plus new) validates. */
  ok: boolean
  /** The normalised questions that would be written. Only meaningful when ok is true. */
  questions: unknown[]
  issues: Issue[]
  report: Report | null
}

export function runImport(args: {
  text: string
  format: ImportFormat
  label: string
  existing: ContentInput
  now: string
}): ImportResult {
  const parsed = args.format === 'csv' ? csvToRecords(args.text, args.label) : jsonToRecords(args.text, args.label)
  const parseErrors = parsed.issues.filter((i) => i.severity === 'error')
  if (parseErrors.length > 0 || parsed.records.length === 0) {
    const none = parsed.records.length === 0 && parseErrors.length === 0
    return {
      ok: false,
      questions: [],
      issues: none ? [...parsed.issues, issue('error', 'empty-file', args.label, 'no questions found in the file')] : parsed.issues,
      report: null,
    }
  }
  const safe = applySafeDefaults(parsed.records, args.now)
  const report = validateContent({ ...args.existing, questions: [...args.existing.questions, ...safe.records] })
  const issues = [...parsed.issues, ...safe.issues, ...report.errors, ...report.warnings]
  return {
    ok: report.ok,
    questions: safe.records.map((r) => r.data),
    issues,
    report,
  }
}
