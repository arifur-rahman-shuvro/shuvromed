import type { Cols } from '../workspace/store/types'
import type { PageResult, ServerRow, VersionRow, WorkspaceRemote, WriteResult } from '../workspace/sync/remote'
import { normName } from '../workspace/model'

/** Link tables have no id column: their key columns identify a row (like the real tables). */
export const LINK_KEYS: Record<string, { key: string[]; parent: string; fk: string }> = {
  user_question_topics: { key: ['question_id', 'topic_id'], parent: 'user_questions', fk: 'question_id' },
  user_question_tag_links: { key: ['question_id', 'tag_id'], parent: 'user_questions', fk: 'question_id' },
}
const MEANING = ['question_type', 'stem', 'content', 'explanation', 'reference', 'difficulty']

export interface FakeServer extends WorkspaceRemote {
  tables: Map<string, Map<string, ServerRow>>
  /** Simulate the network being down. */
  down: boolean
  /** Fail the next N writes with a rule violation. */
  refuse: { code: string; message: string } | null
  calls: string[]
  /** Change a row as another device would. */
  external(table: string, id: string, patch: Cols, at?: string): void
  externalInsert(table: string, row: Cols, at?: string): ServerRow
  externalDelete(table: string, id: string): void
  /** Lose the answer of the next successful insert (the row is saved but the device never hears back). */
  loseNextAck: boolean
  /** Tables the server does not have (as before a migration is applied). */
  missingTables: Set<string>
  /** Saved versions per question, newest last. */
  versions: Map<string, VersionRow[]>
}

/** An in-memory stand-in for the Supabase tables: ids, server timestamps, row_version and the unique-name rule. */
export function fakeServer(tick: () => string = (() => { let n = 0; return () => new Date(Date.UTC(2026, 10, 8, 12, 0, ++n)).toISOString() })()): FakeServer {
  const tables = new Map<string, Map<string, ServerRow>>()
  const t = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) as Map<string, ServerRow> }
  const record = (q: ServerRow) => {
    const subject = t('user_subjects').get(String(q.subject_id))
    const row: VersionRow = {
      version: Number(q.current_version), question_type: String(q.question_type), stem: String(q.stem), difficulty: (q.difficulty as string | null) ?? null,
      content: q.content, explanation: (q.explanation as string | null) ?? null, reference: (q.reference as string | null) ?? null,
      subject_id: String(q.subject_id), subject_name: String(subject?.name ?? ''), created_at: String(q.updated_at),
    }
    s.versions.set(q.id, [...(s.versions.get(q.id) ?? []), row])
  }
  const downErr = { ok: false as const, message: 'Failed to fetch', transient: true }
  const s: FakeServer = {
    tables, down: false, refuse: null, calls: [], loseNextAck: false, missingTables: new Set(), versions: new Map(),
    async fetchPage(table, { since, offset, limit }): Promise<PageResult> {
      s.calls.push(`fetch ${table}`)
      if (s.down) return { ok: false, message: 'Failed to fetch', transient: true }
      if (s.missingTables.has(table)) return { ok: false, message: `Could not find the table 'public.${table}' in the schema cache`, transient: false, code: 'PGRST205' }
      const rows = [...t(table).values()].filter((r) => !since || r.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
      return { ok: true, rows: rows.slice(offset, offset + limit).map((r) => ({ ...r })) }
    },
    async fetchVersions(questionId) {
      s.calls.push('versions')
      if (s.down) return { ok: false, message: 'Failed to fetch', transient: true }
      return { ok: true, rows: [...(s.versions.get(questionId) ?? [])].reverse() }
    },
    async fetchChildren(table, fk, parentIds): Promise<PageResult> {
      s.calls.push(`children ${table}`)
      if (s.down) return { ok: false, message: 'Failed to fetch', transient: true }
      const rows = [...t(table).values()].filter((r) => parentIds.includes(String(r[fk])))
      return { ok: true, rows: rows.map((r) => ({ ...r })) }
    },
    async insert(table, row): Promise<WriteResult> {
      s.calls.push(`insert ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      const link = LINK_KEYS[table]
      if (link) {
        const id = link.key.map((k) => String(row[k])).join(':')
        if (t(table).has(id)) return { ok: false, message: 'duplicate key', code: '23505', transient: false }
        const q = t(link.parent).get(String(row[link.fk]))
        if (!q) return { ok: false, message: 'violates foreign key constraint', code: '23503', transient: false }
        if (table === 'user_question_topics') {
          const topic = t('user_topics').get(String(row.topic_id))
          if (!topic || topic.subject_id !== q.subject_id) return { ok: false, message: 'A topic can only be added to a question in the same subject', code: '23514', transient: false }
        }
        if (table === 'user_question_tag_links') {
          if (!t('user_tags').get(String(row.tag_id))) return { ok: false, message: 'violates foreign key constraint', code: '23503', transient: false }
          if ([...t(table).values()].filter((l) => l.question_id === row.question_id).length >= 60) return { ok: false, message: 'A question can have at most 60 tags', code: '23514', transient: false }
        }
        const at = tick()
        t(table).set(id, { owner_id: 'me', created_at: at, ...row, id, updated_at: at })
        t(link.parent).set(q.id, { ...q, updated_at: at, row_version: Number(q.row_version) + 1 }) // the real database marks the question as changed
        return { ok: true, row: { ...(t(table).get(id) as ServerRow) } }
      }
      const id = String(row.id)
      if (t(table).has(id)) return { ok: false, message: 'duplicate key', code: '23505', transient: false }
      if (table === 'user_exams' && [...t(table).values()].some((r) => normName(String(r.name)) === normName(String(row.name)))) {
        return { ok: false, message: 'duplicate key value violates unique constraint', code: '23505', transient: false }
      }
      if (table === 'user_sessions') {
        if (row.exam_id && !t('user_exams').get(String(row.exam_id))) return { ok: false, message: 'violates foreign key constraint', code: '23503', transient: false }
        if (row.status === 'finished' && [row.finished_at, row.score, row.max_score, row.correct, row.incorrect, row.partial, row.unanswered].some((x) => x == null)) return { ok: false, message: 'finished session needs a result', code: '23514', transient: false }
      }
      if (table === 'user_question_attempts') {
        const v = (s.versions.get(String(row.question_id)) ?? []).some((x) => x.version === Number(row.question_version))
        if (!v) return { ok: false, message: 'violates foreign key constraint (question version)', code: '23503', transient: false }
        if (row.session_id && !t('user_sessions').get(String(row.session_id))) return { ok: false, message: 'violates foreign key constraint (session)', code: '23503', transient: false }
      }
      if (table === 'user_tags' && [...t(table).values()].some((r) => r.category === row.category && normName(String(r.name)) === normName(String(row.name)))) {
        return { ok: false, message: 'duplicate key value violates unique constraint', code: '23505', transient: false }
      }
      if ((table === 'user_subjects' || table === 'user_topics') && [...t(table).values()].some((r) => normName(String(r.name)) === normName(String(row.name)) && (table === 'user_subjects' || (r.subject_id === row.subject_id && (r.parent_id ?? null) === (row.parent_id ?? null))))) {
        return { ok: false, message: 'duplicate key value violates unique constraint', code: '23505', transient: false }
      }
      const at = tick()
      const saved: ServerRow = { owner_id: 'me', created_at: at, row_version: 1, ...row, id, updated_at: at }
      if (table === 'user_questions') { saved.current_version = 1; saved.deleted_at = saved.deleted_at ?? null; saved.archived_at = saved.archived_at ?? null }
      t(table).set(id, saved)
      if (table === 'user_questions') record(saved)
      if (s.loseNextAck) { s.loseNextAck = false; return downErr }
      return { ok: true, row: { ...saved } }
    },
    async update(table, id, patch): Promise<WriteResult> {
      s.calls.push(`update ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      const cur = t(table).get(id)
      if (!cur) return { ok: true, row: null }
      const saved: ServerRow = { ...cur, ...patch, id, updated_at: tick(), row_version: Number(cur.row_version) + 1 }
      if (table === 'user_question_attempts') return { ok: false, message: 'permission denied for table user_question_attempts', code: '42501', transient: false }
      if (table === 'user_sessions' && cur.status === 'finished' && ['status', 'kind', 'config', 'question_ids', 'started_at', 'finished_at', 'score', 'max_score', 'correct', 'incorrect', 'partial', 'unanswered', 'elapsed_ms'].some((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(saved[k] ?? null))) {
        return { ok: false, message: 'A finished session cannot be changed', code: '23514', transient: false }
      }
      if (table === 'user_questions') {
        const changed = MEANING.some((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(saved[k] ?? null))
        saved.current_version = Number(cur.current_version) + (changed ? 1 : 0) // only a change of meaning makes a new version
        if (patch.subject_id && patch.subject_id !== cur.subject_id && [...t('user_question_topics').values()].some((l) => l.question_id === id)) {
          return { ok: false, message: "Remove this question's topics before moving it to another subject", code: '23514', transient: false }
        }
      }
      t(table).set(id, saved)
      if (table === 'user_questions' && saved.current_version !== cur.current_version) record(saved)
      return { ok: true, row: { ...saved } }
    },
    async remove(table, id) {
      s.calls.push(`remove ${table}`)
      if (s.down) return downErr
      if (s.refuse) return { ok: false, ...s.refuse, transient: false }
      const link = LINK_KEYS[table]
      const gone = t(table).get(id)
      if (table === 'user_sessions' || table === 'user_question_attempts') return { ok: false, message: 'permission denied (history is kept)', code: '42501', transient: false }
      t(table).delete(id)
      if (table === 'user_exams') for (const [k, ses] of [...t('user_sessions')]) if (ses.exam_id === id) t('user_sessions').set(k, { ...ses, exam_id: null, updated_at: tick(), row_version: Number(ses.row_version) + 1 })
      if (table === 'user_tags') { // deleting a tag removes its links and marks their questions as changed, like the real database
        for (const [k, l] of [...t('user_question_tag_links')]) {
          if (l.tag_id !== id) continue
          t('user_question_tag_links').delete(k)
          const q = t('user_questions').get(String(l.question_id))
          if (q) t('user_questions').set(q.id, { ...q, updated_at: tick(), row_version: Number(q.row_version) + 1 })
        }
      }
      if (link && gone) { const q = t(link.parent).get(String(gone[link.fk])); if (q) t(link.parent).set(q.id, { ...q, updated_at: tick(), row_version: Number(q.row_version) + 1 }) }
      return { ok: true }
    },
    external(table, id, patch, at) {
      const cur = t(table).get(id) as ServerRow
      t(table).set(id, { ...cur, ...patch, updated_at: at ?? tick(), row_version: Number(cur.row_version) + 1 })
    },
    externalInsert(table, row, at) {
      const when = at ?? tick()
      const saved: ServerRow = { owner_id: 'me', created_at: when, row_version: 1, id: `ext-${t(table).size + 1}`, ...row, updated_at: when } as ServerRow
      t(table).set(saved.id, saved)
      return saved
    },
    externalDelete(table, id) { t(table).delete(id) },
  }
  return s
}
