import { describe, expect, it } from 'vitest'
import { buildBundle } from '../content/bundle'
import { CSV_COLUMNS, applySafeDefaults, csvToRecords, parseCsv, runImport } from '../content/import'
import { isStudentVisible } from '../content/visibility'
import { validateContent } from '../content/validate'
import type { Question } from '../content/schema'
import { fakeHash, realContent, toInput } from './content'

const NOW = '2026-11-06T12:00:00Z'
const existing = toInput(realContent())

const q = (c: string) => `"${c.replace(/"/g, '""')}"`
function csv(rows: Record<string, string>[], columns = CSV_COLUMNS): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => q(r[c] ?? '')).join(','))].join('\r\n')
}
const row = (over: Record<string, string> = {}): Record<string, string> => ({
  id: 'import-test-001',
  subjectId: 'Anatomy',
  topicId: 'anatomy-heart',
  difficulty: 'Medium',
  format: 'sba-5',
  examTags: 'MBBS; ukmla',
  stem: 'A made-up test stem that is long enough to pass validation, with a comma, and "quotes".',
  optionA: 'Alpha', optionB: 'Bravo', optionC: 'Charlie', optionD: 'Delta', optionE: 'Echo',
  correctOptionId: 'b',
  explanation: 'Bravo is correct for the purposes of this test.',
  analysisA: 'No.', analysisB: 'Yes.', analysisC: 'No.', analysisD: 'No.', analysisE: 'No.',
  learningObjectives: 'First objective; Second objective',
  ...over,
})
const run = (text: string, format: 'csv' | 'json' = 'csv', ex = existing) =>
  runImport({ text, format, label: 'in.' + format, existing: ex, now: NOW })

describe('CSV parser', () => {
  it('handles quoted commas, escaped quotes, newlines inside quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n')
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', 'z']])
  })
  it('strips a BOM, skips blank rows, keeps empty cells', () => {
    expect(parseCsv('﻿a,b,c\n\n1,,3\n,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']])
  })
  it('rejects an unterminated quote instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a,b\n"oops,1\n')).toThrow(/unterminated/)
  })
})

describe('CSV to question records', () => {
  it('maps columns, normalises case, and splits lists', () => {
    const { records, issues } = csvToRecords(csv([row()]), 'in.csv')
    expect(issues).toEqual([])
    const d = records[0].data as Record<string, unknown>
    expect(d).toMatchObject({ subjectId: 'anatomy', difficulty: 'medium', correctOptionId: 'B', examTags: ['mbbs', 'ukmla'] })
    expect(d.learningObjectives).toEqual(['First objective', 'Second objective'])
    expect((d.options as unknown[]).length).toBe(5)
    expect(records[0].source).toBe('in.csv[row 2]')
  })
  it('supports 4-option questions by leaving option E empty', () => {
    const { records } = csvToRecords(csv([row({ optionE: '', analysisE: '', format: 'mcq-4' })]), 'in.csv')
    const d = records[0].data as { options: unknown[]; optionAnalysis: object }
    expect(d.options).toHaveLength(4)
    expect(Object.keys(d.optionAnalysis)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('reports missing required columns as an error', () => {
    const r = csvToRecords('id,stem\nx,y', 'in.csv')
    expect(r.records).toEqual([])
    expect(r.issues[0]).toMatchObject({ severity: 'error', code: 'missing-column' })
    expect(r.issues[0].message).toContain('subjectId')
  })
  it('warns about unknown columns and errors on bad references JSON', () => {
    const cols = [...CSV_COLUMNS, 'mystery']
    const r = csvToRecords(csv([row({ references: '[not json' })], cols), 'in.csv')
    expect(r.issues.map((i) => i.code).sort()).toEqual(['bad-references-json', 'unknown-column'])
  })
  it('parses a valid references JSON cell', () => {
    const refs = JSON.stringify([{ kind: 'textbook', title: 'A real title the owner supplied' }])
    const d = csvToRecords(csv([row({ references: refs })]), 'in.csv').records[0].data as { references: unknown[] }
    expect(d.references).toHaveLength(1)
  })
})

describe('safety defaults', () => {
  it('forces draft + unreviewed and fills dates, warning when it overrides a claim', () => {
    const { records, issues } = applySafeDefaults(
      [{ source: 's[0]', data: { id: 'x', status: 'published', unreviewed: false } }, { source: 's[1]', data: { id: 'y' } }],
      NOW,
    )
    expect(records.map((r) => r.data)).toMatchObject([
      { status: 'draft', unreviewed: true, createdAt: NOW, updatedAt: NOW },
      { status: 'draft', unreviewed: true },
    ])
    expect(issues.map((i) => i.code).sort()).toEqual(['review-flag-reset', 'status-reset'])
  })
  it('keeps dates the file supplied', () => {
    const { records } = applySafeDefaults([{ source: 's', data: { id: 'x', createdAt: '2020-01-01T00:00:00Z' } }], NOW)
    expect((records[0].data as { createdAt: string }).createdAt).toBe('2020-01-01T00:00:00Z')
  })
})

describe('runImport', () => {
  it('accepts a valid CSV batch and returns draft, unreviewed questions', () => {
    const r = run(csv([row(), row({ id: 'import-test-002', correctOptionId: 'C', analysisB: 'No.', analysisC: 'Yes.' })]))
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0]).toMatchObject({ status: 'draft', unreviewed: true })
    expect(r.questions[0]).not.toHaveProperty('isDemo') // imports are real content, never labelled demo
  })
  it('can NOT publish: a file claiming published + reviewed still comes out draft + unreviewed', () => {
    const json = JSON.stringify([{ ...(existing.questions[0].data as object), id: 'claims-published-001', status: 'published', unreviewed: false, isDemo: false,
      references: [{ kind: 'textbook', title: 'Some textbook' }] }])
    const r = run(json, 'json')
    expect(r.ok).toBe(true)
    const out = r.questions[0] as Question
    expect(out.status).toBe('draft')
    expect(out.unreviewed).toBe(true)
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['status-reset', 'review-flag-reset']))
  })
  it('imported questions never reach the student bundle', () => {
    const r = run(csv([row()]))
    const all = validateContent({ ...existing, questions: [...existing.questions, ...r.questions.map((data, i) => ({ source: `n[${i}]`, data }))] })
    expect(all.ok).toBe(true)
    const imported = all.content.questions.find((x) => x.id === 'import-test-001')!
    expect(isStudentVisible(imported, { allowDemo: true })).toBe(false)
    const bundle = buildBundle(all.content, { includeDemo: true }, fakeHash)
    expect(Object.values(bundle.questionFiles).flat().some((x) => x.id === 'import-test-001')).toBe(false)
  })
  it('rejects a duplicate id against existing content', () => {
    const r = run(csv([row({ id: 'demo-anat-cor-001' })]))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'duplicate-id')).toBe(true)
  })
  it('rejects duplicate ids inside the same file', () => {
    const r = run(csv([row(), row()]))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'duplicate-id')).toBe(true)
  })
  it('rejects an unknown topic, unknown exam style and a wrong option count', () => {
    expect(run(csv([row({ topicId: 'no-such-topic' })])).issues.some((i) => i.code === 'unknown-topic')).toBe(true)
    expect(run(csv([row({ examTags: 'not-a-style' })])).issues.some((i) => i.code === 'unknown-exam-tag')).toBe(true)
    expect(run(csv([row({ format: 'mcq-4' })])).issues.some((i) => i.code === 'option-count')).toBe(true)
  })
  it('rejects a correct answer that is not an option and missing option analysis', () => {
    expect(run(csv([row({ optionE: '', analysisE: '', format: 'mcq-4', correctOptionId: 'E' })])).ok).toBe(false)
    expect(run(csv([row({ analysisC: '' })])).ok).toBe(false)
  })
  it('rejects empty and malformed input without throwing', () => {
    expect(run('', 'csv').ok).toBe(false)
    expect(run('[]', 'json').ok).toBe(false)
    expect(run('{"not":"an array"}', 'json').issues[0].code).toBe('not-array')
    expect(run('{oops', 'json').issues[0].code).toBe('json-parse')
    expect(run('a,b\n"open', 'csv').issues[0].code).toBe('csv-parse')
  })
  it('stops if the existing content is already invalid, so errors are never hidden', () => {
    const broken = { ...existing, topics: [...existing.topics, { source: 'bad', data: { id: 'Bad Id' } }] }
    expect(run(csv([row()]), 'csv', broken).ok).toBe(false)
  })
})

describe('validator: option letters', () => {
  it('warns when an explanation refers to an option by letter, unless the order is fixed', () => {
    const base = realContent().questions[0]
    const bad = { ...base, explanation: 'Option C is wrong because it is the left marginal.' }
    const warn = (x: unknown) => validateContent({ ...existing, questions: [{ source: 'q', data: x }] }).warnings.map((w) => w.code)
    expect(warn(bad)).toContain('option-letter-reference')
    expect(warn({ ...bad, fixedOptionOrder: true })).not.toContain('option-letter-reference')
    expect(warn({ ...base, explanation: 'Choose an answer after reading each option carefully.' })).not.toContain('option-letter-reference')
  })
})
