import type { MockResult } from '../mock/mock'
import { addAttempts, loadAttempts, type Attempt } from '../practice/attempts'
import { loadMock, mergeResults } from '../mock/store'
import { flagKey, type UserData } from '../userdata/model'
import { loadUserData, updateUserData } from '../userdata/store'
import { EXPORT_FORMAT, EXPORT_VERSION, ExportFileSchema, MAX_IMPORT_BYTES, sha256Hex, type ExportFile } from './export'

export type Parsed = { ok: true; file: ExportFile } | { ok: false; error: string }

/** Reads and checks a backup file. Anything wrong gives a plain-language reason and changes nothing. */
export async function parseImport(text: string): Promise<Parsed> {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'This file is too large to be a ShuvroMed backup (over 25 MB).' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This is not a ShuvroMed backup file (it could not be read as JSON).' }
  }
  const head = json as { format?: unknown; version?: unknown }
  if (!head || typeof head !== 'object' || head.format !== EXPORT_FORMAT) return { ok: false, error: 'This is not a ShuvroMed backup file.' }
  if (typeof head.version === 'number' && head.version > EXPORT_VERSION) return { ok: false, error: 'This backup was made by a newer version of ShuvroMed. Update the app and try again.' }
  const r = ExportFileSchema.safeParse(json)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `The backup file is damaged or was edited (problem at ${i.path.join(' > ') || 'file'}: ${i.message}). Nothing was changed.` }
  }
  if ((await sha256Hex(JSON.stringify(r.data.data))) !== r.data.checksum) return { ok: false, error: 'The backup file does not match its checksum, so it is damaged or was edited. Nothing was changed.' }
  return { ok: true, file: r.data }
}

export interface ImportReport {
  attempts: { add: number; skip: number }
  collections: { add: number; skip: number }
  bookmarks: { add: number; skip: number }
  notes: { add: number; skip: number }
  flags: { add: number; skip: number }
  mockResults: { add: number; skip: number }
}

export interface ImportPlan {
  report: ImportReport
  attempts: Attempt[]
  userData: UserData
  mockResults: MockResult[]
}

/**
 * Pure: what restoring would change. Restore only ADDS. Anything already on the account is kept as it is
 * (a note you already have is never replaced), so restoring the same file twice changes nothing the second time.
 * Everything added is marked as not yet uploaded, so it syncs to the account like new work.
 */
export function planImport(file: ExportFile, current: { attempts: readonly Attempt[]; userData: UserData; mockResults: readonly MockResult[] }): ImportPlan {
  const d = file.data
  const count = () => ({ add: 0, skip: 0 })
  const report: ImportReport = { attempts: count(), collections: count(), bookmarks: count(), notes: count(), flags: count(), mockResults: count() }
  const u = current.userData

  const haveAttempts = new Set(current.attempts.map((a) => a.id))
  const attempts = d.attempts.filter((a) => {
    const fresh = !haveAttempts.has(a.id)
    report.attempts[fresh ? 'add' : 'skip'] += 1
    haveAttempts.add(a.id)
    return fresh
  })

  // Collections: the same id, or the same name (any capitalisation), is the same collection.
  const collections = [...u.collections]
  const idMap = new Map<string, string>()
  for (const c of d.collections) {
    const same = collections.find((x) => x.id === c.id || x.name.toLowerCase() === c.name.toLowerCase())
    if (same) {
      idMap.set(c.id, same.id)
      report.collections.skip += 1
    } else {
      collections.push({ id: c.id, name: c.name, createdAt: c.createdAt, synced: false })
      idMap.set(c.id, c.id)
      report.collections.add += 1
    }
  }

  let outbox = [...u.outbox]
  const bookmarks = [...u.bookmarks]
  for (const b of d.bookmarks) {
    if (bookmarks.some((x) => x.questionId === b.questionId)) { report.bookmarks.skip += 1; continue }
    outbox = outbox.filter((o) => !(o.table === 'bookmarks' && o.key === b.questionId))
    bookmarks.push({ questionId: b.questionId, collectionId: b.collectionId ? (idMap.get(b.collectionId) ?? null) : null, createdAt: b.createdAt, synced: false })
    report.bookmarks.add += 1
  }

  const notes = [...u.notes]
  for (const n of d.notes) {
    if (notes.some((x) => x.questionId === n.questionId)) { report.notes.skip += 1; continue }
    outbox = outbox.filter((o) => !(o.table === 'question_notes' && o.key === n.questionId))
    notes.push({ questionId: n.questionId, body: n.body, updatedAt: n.updatedAt, dirty: true })
    report.notes.add += 1
  }

  const flags = [...u.flags]
  for (const f of d.flags) {
    if (flags.some((x) => x.questionId === f.questionId && x.reason === f.reason)) { report.flags.skip += 1; continue }
    outbox = outbox.filter((o) => !(o.table === 'flags' && o.key === flagKey(f.questionId, f.reason)))
    flags.push({ questionId: f.questionId, reason: f.reason, comment: f.comment, createdAt: f.createdAt, synced: false })
    report.flags.add += 1
  }

  const haveMock = new Set(current.mockResults.map((r) => r.id))
  const mockResults = d.mockResults.filter((r) => {
    const fresh = !haveMock.has(r.id)
    report.mockResults[fresh ? 'add' : 'skip'] += 1
    return fresh
  })

  return { report, attempts, userData: { ...u, collections, bookmarks, notes, flags, outbox }, mockResults }
}

export interface ApplyResult { ok: boolean; error?: string; report: ImportReport }

/** Applies the plan for this signed-in user. Answers first; if the device refuses to store them, nothing else is changed. */
export function applyImport(userId: string, file: ExportFile): ApplyResult {
  const plan = planImport(file, { attempts: loadAttempts(userId), userData: loadUserData(userId), mockResults: loadMock(userId).results })
  const a = addAttempts(userId, plan.attempts)
  if (!a.ok) return { ok: false, error: a.error, report: plan.report }
  const saved = updateUserData(userId, (cur) => planImport(file, { attempts: [], userData: cur, mockResults: [] }).userData)
  if (!saved.ok) return { ok: false, error: saved.error, report: plan.report }
  const m = mergeResults(userId, plan.mockResults)
  if (!m.ok) return { ok: false, error: m.error, report: plan.report }
  return { ok: true, report: plan.report }
}
