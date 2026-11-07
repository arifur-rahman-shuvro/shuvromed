import { beforeEach, describe, expect, it } from 'vitest'
import { attemptsToCsv, buildExport, exportFileName, exportToText, type ExportSource } from '../backup/export'
import { applyImport, parseImport, planImport } from '../backup/restore'
import { loadMock } from '../mock/store'
import type { MockResult } from '../mock/mock'
import { addAttempt, loadAttempts, type Attempt } from '../practice/attempts'
import { pendingCount } from '../sync/pending'
import { addCollection, emptyUserData, moveBookmark, setNote, toggleBookmark, addFlag, type UserData } from '../userdata/model'
import { loadUserData, saveUserData } from '../userdata/store'
import { asDevice, resetDevices } from './memoryRemote'

const U = 'user-1'
const T = '2026-11-07T05:00:00.000Z'
const C1 = '11111111-1111-4111-8111-111111111111'
const att = (n: number, over: Partial<Attempt> = {}): Attempt => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, questionId: 'q-a', selectedOptionId: 'B', isCorrect: n % 2 === 0, confidence: 4, timeMs: 12_300,
  mode: 'practice', attemptedAt: `2026-11-0${(n % 6) + 1}T04:00:00.000Z`, contentVersion: 'v1', ...over,
})
const mock: MockResult = {
  id: '00000000-0000-4000-8000-0000000000aa', seed: 's', config: { subjectId: null, topicId: null, examStyle: null, count: 2, secondsPerQuestion: 90 },
  questionIds: ['q-a', 'q-b'], answers: { 'q-a': 'A' }, flagged: ['q-b'], startedAt: T, finishedAt: '2026-11-07T05:10:00.000Z', total: 2, answered: 1, correct: 1, timedOut: false,
}
function richData(): UserData {
  let d = emptyUserData()
  d = (addCollection(d, 'Cardio', C1, T) as { data: UserData }).data
  d = toggleBookmark(d, 'q-a', T)
  d = (moveBookmark(d, 'q-a', C1) as { data: UserData }).data
  d = (setNote(d, 'q-a', 'RCA → SA node', T) as { data: UserData }).data
  d = (addFlag(d, 'q-b', 'typo', 'stem', T) as { data: UserData }).data
  return d
}
const source = (over: Partial<ExportSource> = {}): ExportSource => ({ attempts: [att(1), att(2), att(3)], userData: richData(), mockResults: [mock], settings: { dailyGoal: 30, gamification: false }, ...over })

describe('export file', () => {
  it('is valid, versioned, checksummed and the same every time for the same data', async () => {
    const a = await buildExport(source(), new Date(T))
    const b = await buildExport(source({ attempts: [att(3), att(1), att(2)] }), new Date(T)) // different input order
    expect(a).toMatchObject({ format: 'shuvromed-export', version: 1, exportedAt: T })
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(exportToText(a)).toBe(exportToText(b))
    expect(a.data.attempts).toHaveLength(3)
  })
  it('contains no account identifiers and no sync bookkeeping', async () => {
    const text = exportToText(await buildExport(source(), new Date(T)))
    expect(text).not.toMatch(/email|password|token|userId|user_id|synced|dirty|outbox|syncedAttemptIds/i)
  })
  it('names files by date', () => {
    expect(exportFileName(new Date(2026, 10, 7), 'json')).toBe('shuvromed-backup-20261107.json')
    expect(exportFileName(new Date(2026, 10, 7), 'csv')).toBe('shuvromed-answers-20261107.csv')
  })
})

describe('CSV of answers', () => {
  it('has a header, one row per answer in time order, and quotes awkward text', () => {
    const csv = attemptsToCsv([att(2), att(1, { questionId: 'a,"b"' })])
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('attempted_at,question_id,selected_option,is_correct,confidence,time_seconds,mode')
    expect(lines).toHaveLength(3)
    expect(csv).toContain('"a,""b"""')
    expect(lines[1]).toContain('12.3')
  })
  it('defuses spreadsheet formulas in text cells', () => {
    const csv = attemptsToCsv([att(1, { questionId: '=HYPERLINK("http://evil")' }), att(2, { questionId: '+1' }), att(3, { questionId: '@x' })])
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
    expect(csv).toContain(`'=HYPERLINK`)
    expect(csv).toContain(`'+1`)
    expect(csv).toContain(`'@x`)
  })
})

describe('reading a backup file (nothing is trusted)', () => {
  let text: string
  beforeEach(async () => { text = exportToText(await buildExport(source(), new Date(T))) })

  it('accepts a good file', async () => expect((await parseImport(text)).ok).toBe(true))
  it.each([
    ['not JSON', '{nope', /could not be read/],
    ['another kind of JSON', '{"hello":1}', /not a ShuvroMed backup/],
    ['an array', '[]', /not a ShuvroMed backup/],
  ])('rejects %s', async (_n, bad, msg) => {
    const r = await parseImport(bad)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(msg)
  })
  it('rejects a file from a newer app version', async () => {
    const r = await parseImport(text.replace('"version":1', '"version":2'))
    expect(!r.ok && r.error).toMatch(/newer version/)
  })
  it('rejects edited content (checksum), without changing anything', async () => {
    const r = await parseImport(text.replace('"isCorrect":false', '"isCorrect":true'))
    expect(!r.ok && r.error).toMatch(/checksum/)
  })
  it('rejects wrong shapes and unknown fields', async () => {
    const o = JSON.parse(text)
    o.data.attempts[0].selectedOptionId = 'Z'
    expect((await parseImport(JSON.stringify(o))).ok).toBe(false)
    const extra = JSON.parse(text)
    extra.data.extra = 1
    expect((await parseImport(JSON.stringify(extra))).ok).toBe(false)
    const lens = JSON.parse(text)
    lens.data.notes[0].body = 'x'.repeat(5001)
    expect((await parseImport(JSON.stringify(lens))).ok).toBe(false)
  })
  it('rejects oversized files before parsing', async () => {
    const r = await parseImport(' '.repeat(26 * 1024 * 1024))
    expect(!r.ok && r.error).toMatch(/too large/)
  })
})

describe('restoring (adds only, never overwrites)', () => {
  beforeEach(() => { resetDevices(); asDevice('old-phone') })

  it('a round trip into an empty device brings everything back, queued to sync', async () => {
    for (const a of [att(1), att(2), att(3)]) addAttempt(U, a)
    saveUserData(U, richData())
    const file = await buildExport({ attempts: loadAttempts(U), userData: loadUserData(U), mockResults: [mock], settings: {} }, new Date(T))
    const parsed = await parseImport(exportToText(file))
    if (!parsed.ok) throw new Error(parsed.error)

    asDevice('new-phone')
    expect(loadAttempts(U)).toHaveLength(0)
    const r = applyImport(U, parsed.file)
    expect(r.ok).toBe(true)
    expect(r.report).toMatchObject({ attempts: { add: 3, skip: 0 }, collections: { add: 1 }, bookmarks: { add: 1 }, notes: { add: 1 }, flags: { add: 1 }, mockResults: { add: 1 } })
    expect(loadAttempts(U).map((a) => a.id).sort()).toEqual([att(1).id, att(2).id, att(3).id])
    const d = loadUserData(U)
    expect(d.bookmarks[0]).toMatchObject({ questionId: 'q-a', collectionId: C1, synced: false })
    expect(d.notes[0]).toMatchObject({ body: 'RCA → SA node', dirty: true })
    expect(d.flags[0]).toMatchObject({ reason: 'typo', synced: false })
    expect(loadMock(U).results).toHaveLength(1)
    expect(pendingCount(loadAttempts(U), d)).toBeGreaterThan(0) // will upload on the next sync
  })

  it('restoring the same file twice changes nothing the second time', async () => {
    for (const a of [att(1), att(2)]) addAttempt(U, a)
    saveUserData(U, richData())
    const file = await buildExport({ attempts: loadAttempts(U), userData: loadUserData(U), mockResults: [mock], settings: {} }, new Date(T))
    asDevice('new-phone')
    expect(applyImport(U, file).ok).toBe(true)
    const before = JSON.stringify([loadAttempts(U), loadUserData(U), loadMock(U)])
    const again = applyImport(U, file)
    expect(again.report).toMatchObject({ attempts: { add: 0, skip: 2 }, collections: { add: 0 }, bookmarks: { add: 0 }, notes: { add: 0 }, flags: { add: 0 }, mockResults: { add: 0 } })
    expect(JSON.stringify([loadAttempts(U), loadUserData(U), loadMock(U)])).toBe(before)
  })

  it('keeps what is already on the account: existing notes win, same-named collections merge, bookmarks re-point', async () => {
    const file = await buildExport(source(), new Date(T))
    asDevice('other')
    let d = emptyUserData()
    d = (addCollection(d, 'cardio', '22222222-2222-4222-8222-222222222222', T) as { data: UserData }).data
    d = (setNote(d, 'q-a', 'my newer note', '2026-11-07T09:00:00.000Z') as { data: UserData }).data
    saveUserData(U, d)
    const r = applyImport(U, file)
    expect(r.report).toMatchObject({ collections: { add: 0, skip: 1 }, notes: { add: 0, skip: 1 }, bookmarks: { add: 1 } })
    const after = loadUserData(U)
    expect(after.notes[0].body).toBe('my newer note')
    expect(after.collections).toHaveLength(1)
    expect(after.bookmarks[0].collectionId).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('re-adding something deleted here cancels the pending deletion', async () => {
    const file = await buildExport(source(), new Date(T))
    asDevice('other')
    let d: UserData = { ...emptyUserData(), bookmarks: [{ questionId: 'q-a', collectionId: null, createdAt: T, synced: true }] }
    d = toggleBookmark(d, 'q-a', T) // deleted locally, deletion queued
    expect(d.outbox).toHaveLength(1)
    saveUserData(U, d)
    applyImport(U, file)
    const after = loadUserData(U)
    expect(after.bookmarks.map((b) => b.questionId)).toEqual(['q-a'])
    expect(after.outbox.filter((o) => o.table === 'bookmarks')).toEqual([])
  })

  it('planning does not touch storage', async () => {
    const file = await buildExport(source(), new Date(T))
    asDevice('empty')
    const plan = planImport(file, { attempts: [], userData: emptyUserData(), mockResults: [] })
    expect(plan.report.attempts.add).toBe(3)
    expect(loadAttempts(U)).toHaveLength(0)
  })
})
