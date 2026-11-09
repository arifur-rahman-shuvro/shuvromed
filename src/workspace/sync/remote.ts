import type { SupabaseClient } from '@supabase/supabase-js'
import type { Cols } from '../store/types'

export type ServerRow = Cols & { id: string; updated_at: string }

export type WriteResult =
  | { ok: true; row: ServerRow | null }
  /** `transient`: the network or server is unavailable, so the change stays queued and is retried.
   *  Otherwise the server refused it because of a rule (duplicate name, not allowed...) and retrying would not help. */
  | { ok: false; message: string; code?: string; transient: boolean }

export type PageResult = { ok: true; rows: ServerRow[] } | { ok: false; message: string; transient: boolean; code?: string }

/** The server says the table does not exist (its migration has not been applied). */
export const isMissingTable = (code?: string): boolean => code === 'PGRST205' || code === '42P01'

/** What sync needs from the server. The real one talks to Supabase; tests use an in-memory one. */
export interface WorkspaceRemote {
  /** One page of rows. With `since`, only rows changed at or after that time (cursor tables). */
  fetchPage(table: string, opts: { since: string | null; offset: number; limit: number }): Promise<PageResult>
  /** The links (rows with no id) of the given parent rows. Each returned row has a made-up `id` (its key values joined by ":")
   *  and `updated_at` taken from `created_at`. */
  fetchChildren(table: string, fk: string, parentIds: string[], key: string[]): Promise<PageResult>
  insert(table: string, row: Cols): Promise<WriteResult>
  /** `row: null` in the result means no such row exists on the server. */
  update(table: string, id: string, patch: Cols): Promise<WriteResult>
  /** Every saved version of one question, newest first. Needs the network: versions are not kept on the device. */
  fetchVersions(questionId: string): Promise<VersionsResult>
  /** `match` is given for link tables, which have no id column. */
  remove(table: string, id: string, match?: Cols): Promise<{ ok: true } | { ok: false; message: string; code?: string; transient: boolean }>
}

/** One saved version of a question, as the server recorded it (versions are never edited or removed). */
export interface VersionRow {
  version: number
  question_type: string
  stem: string
  difficulty: string | null
  content: unknown
  explanation: string | null
  reference: string | null
  subject_id: string
  subject_name: string
  created_at: string
}
export type VersionsResult = { ok: true; rows: VersionRow[] } | { ok: false; message: string; transient: boolean }

export const PAGE_SIZE = 1000
/** How many parents' links are read in one request (keeps the address short enough). */
export const CHILD_CHUNK = 80
/** A request that has not answered by then counts as a network failure (a weak connection can hang for minutes). */
export const REQUEST_TIMEOUT_MS = 20_000
const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS)

const isTransient = (e: { code?: string; message?: string; status?: number } | null | undefined): boolean => {
  if (!e) return false
  if (e.code && /^(23|22|42|P0)/.test(e.code)) return false // a rule or permission, not the network
  if (e.code === 'PGRST116') return false
  return true
}

export function supabaseWorkspaceRemote(sb: SupabaseClient): WorkspaceRemote {
  const fail = (e: { code?: string; message?: string } | unknown): { ok: false; message: string; code?: string; transient: boolean } => {
    const err = (e ?? {}) as { code?: string; message?: string }
    return { ok: false, message: err.message || 'Network problem', code: err.code, transient: isTransient(err) }
  }
  return {
    async fetchPage(table, { since, offset, limit }) {
      try {
        let q = sb.from(table).select('*')
        if (since) q = q.gte('updated_at', since)
        const { data, error } = await q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1).abortSignal(timeout())
        if (error) return { ok: false, message: error.message, transient: isTransient(error), code: error.code }
        return { ok: true, rows: (data ?? []) as ServerRow[] }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Network problem', transient: true }
      }
    },
    async fetchVersions(questionId) {
      try {
        const { data, error } = await sb.from('user_question_versions')
          .select('version,question_type,stem,difficulty,content,explanation,reference,subject_id,subject_name,created_at')
          .eq('question_id', questionId).order('version', { ascending: false }).abortSignal(timeout())
        if (error) return { ok: false, message: error.message, transient: isTransient(error) }
        return { ok: true, rows: (data ?? []) as VersionRow[] }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Network problem', transient: true }
      }
    },
    async fetchChildren(table, fk, parentIds, key) {
      try {
        const { data, error } = await sb.from(table).select('*').in(fk, parentIds).abortSignal(timeout())
        if (error) return { ok: false, message: error.message, transient: isTransient(error) }
        const rows = ((data ?? []) as Cols[]).map((r) => ({ ...r, id: key.map((k) => String(r[k])).join(':'), updated_at: String(r.created_at) }))
        return { ok: true, rows: rows as ServerRow[] }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Network problem', transient: true }
      }
    },
    async insert(table, row) {
      try {
        const { data, error } = await sb.from(table).insert(row).select('*').abortSignal(timeout()).single()
        return error ? fail(error) : { ok: true, row: data as ServerRow }
      } catch (e) { return fail(e) }
    },
    async update(table, id, patch) {
      try {
        const { data, error } = await sb.from(table).update(patch).eq('id', id).select('*').abortSignal(timeout()).maybeSingle()
        return error ? fail(error) : { ok: true, row: (data as ServerRow | null) ?? null }
      } catch (e) { return fail(e) }
    },
    async remove(table, id, match) {
      try {
        const q = sb.from(table).delete()
        const { error } = await (match ? q.match(match) : q.eq('id', id)).abortSignal(timeout())
        return error ? fail(error) : { ok: true }
      } catch (e) { return fail(e) }
    },
  }
}
