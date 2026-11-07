import type { SupabaseClient } from '@supabase/supabase-js'
import { AttemptSchema, type Attempt } from '../practice/attempts'
import { FLAG_REASONS, type FlagReason, type OutboxItem } from '../userdata/model'
import type { ServerSnapshot } from './merge'

/** What the sync engine needs from the server. The real one talks to Supabase; tests use an in-memory one. */
export type Result = { ok: true } | { ok: false; error: string }
export type Fetched<T> = { ok: true; value: T } | { ok: false; error: string }
export type RemoteAttempt = Attempt & { createdAt: string }

export interface SyncRemote {
  fetchSnapshot(): Promise<Fetched<ServerSnapshot>>
  /** Attempts the server received at or after `sinceIso` (all of them when null). */
  fetchAttempts(sinceIso: string | null): Promise<Fetched<RemoteAttempt[]>>
  pushCollections(rows: { id: string; name: string; createdAt: string }[]): Promise<Result>
  pushBookmarks(rows: { questionId: string; collectionId: string | null; createdAt: string }[]): Promise<Result>
  pushNotes(rows: { questionId: string; body: string }[]): Promise<Result>
  pushFlags(rows: { questionId: string; reason: FlagReason; comment: string | null; createdAt: string }[]): Promise<Result>
  pushAttempts(rows: Attempt[]): Promise<Result>
  deleteRows(items: OutboxItem[]): Promise<Result>
}

const PAGE = 1000
export const CHUNK = 200

const message = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Unknown error')
const norm = (iso: string) => new Date(iso).toISOString()

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

async function pageAll<T>(make: (from: number, to: number) => Page<T>): Promise<Fetched<T[]>> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1)
    if (error) return { ok: false, error: error.message }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) return { ok: true, value: all }
  }
}

export function supabaseRemote(client: SupabaseClient, userId: string): SyncRemote {
  const guard = async <T>(f: () => Promise<T>, fallback: (e: string) => T): Promise<T> => {
    try {
      return await f()
    } catch (e) {
      return fallback(message(e)) // network down, aborted, etc.
    }
  }
  const failed = (e: string): { ok: false; error: string } => ({ ok: false, error: e })
  const write = (f: () => PromiseLike<{ error: { message: string } | null }>): Promise<Result> =>
    guard(async () => {
      const { error } = await f()
      return error ? failed(error.message) : { ok: true as const }
    }, failed)
  const chunks = async <T>(rows: T[], send: (part: T[]) => Promise<Result>): Promise<Result> => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const r = await send(rows.slice(i, i + CHUNK))
      if (!r.ok) return r
    }
    return { ok: true }
  }

  return {
    fetchSnapshot: () =>
      guard<Fetched<ServerSnapshot>>(async () => {
        const [c, b, n, f] = await Promise.all([
          pageAll<{ id: string; name: string; created_at: string }>((a, z) => client.from('bookmark_collections').select('id,name,created_at').eq('user_id', userId).order('created_at').order('id').range(a, z)),
          pageAll<{ question_id: string; collection_id: string | null; created_at: string }>((a, z) => client.from('bookmarks').select('question_id,collection_id,created_at').eq('user_id', userId).order('question_id').range(a, z)),
          pageAll<{ question_id: string; body: string; updated_at: string }>((a, z) => client.from('question_notes').select('question_id,body,updated_at').eq('user_id', userId).order('question_id').range(a, z)),
          // Admins can read everyone's flags, so the user filter matters here.
          pageAll<{ question_id: string; reason: string; comment: string | null; created_at: string }>((a, z) => client.from('flags').select('question_id,reason,comment,created_at').eq('user_id', userId).order('question_id').order('reason').range(a, z)),
        ])
        if (!c.ok) return failed(c.error)
        if (!b.ok) return failed(b.error)
        if (!n.ok) return failed(n.error)
        if (!f.ok) return failed(f.error)
        return {
          ok: true,
          value: {
            collections: c.value.map((r) => ({ id: r.id, name: r.name, createdAt: norm(r.created_at) })),
            bookmarks: b.value.map((r) => ({ questionId: r.question_id, collectionId: r.collection_id, createdAt: norm(r.created_at) })),
            notes: n.value.map((r) => ({ questionId: r.question_id, body: r.body, updatedAt: norm(r.updated_at) })),
            flags: f.value.flatMap((r) =>
              (FLAG_REASONS as readonly string[]).includes(r.reason)
                ? [{ questionId: r.question_id, reason: r.reason as FlagReason, comment: r.comment, createdAt: norm(r.created_at) }]
                : [],
            ),
          },
        }
      }, failed),

    fetchAttempts: (since) =>
      guard<Fetched<RemoteAttempt[]>>(async () => {
        type Row = { id: string; question_id: string; selected_option: string; is_correct: boolean; confidence: number | null; time_ms: number; mode: string; attempted_at: string; created_at: string }
        const r = await pageAll<Row>((a, z) => {
          let q = client.from('attempts').select('id,question_id,selected_option,is_correct,confidence,time_ms,mode,attempted_at,created_at').eq('user_id', userId)
          if (since) q = q.gte('created_at', since)
          return q.order('created_at').order('id').range(a, z)
        })
        if (!r.ok) return failed(r.error)
        const value = r.value.flatMap((row) => {
          const parsed = AttemptSchema.safeParse({
            id: row.id, questionId: row.question_id, selectedOptionId: row.selected_option, isCorrect: row.is_correct,
            ...(row.confidence ? { confidence: row.confidence } : {}), timeMs: row.time_ms, mode: row.mode,
            attemptedAt: norm(row.attempted_at), contentVersion: 'synced',
          })
          return parsed.success ? [{ ...parsed.data, createdAt: norm(row.created_at) }] : [] // skip a row we cannot understand
        })
        return { ok: true, value }
      }, failed),

    pushCollections: (rows) =>
      chunks(rows, (part) => write(() => client.from('bookmark_collections').upsert(part.map((r) => ({ id: r.id, user_id: userId, name: r.name, created_at: r.createdAt })), { onConflict: 'id' }))),
    pushBookmarks: (rows) =>
      chunks(rows, (part) => write(() => client.from('bookmarks').upsert(part.map((r) => ({ user_id: userId, question_id: r.questionId, collection_id: r.collectionId, created_at: r.createdAt })), { onConflict: 'user_id,question_id' }))),
    pushNotes: (rows) =>
      chunks(rows, (part) => write(() => client.from('question_notes').upsert(part.map((r) => ({ user_id: userId, question_id: r.questionId, body: r.body })), { onConflict: 'user_id,question_id' }))),
    pushFlags: (rows) =>
      chunks(rows, (part) => write(() => client.from('flags').upsert(part.map((r) => ({ user_id: userId, question_id: r.questionId, reason: r.reason, comment: r.comment, created_at: r.createdAt })), { onConflict: 'user_id,question_id,reason', ignoreDuplicates: true }))),
    pushAttempts: (rows) =>
      chunks(rows, (part) =>
        write(() =>
          client.from('attempts').upsert(
            part.map((a) => ({ id: a.id, user_id: userId, question_id: a.questionId, selected_option: a.selectedOptionId, is_correct: a.isCorrect, confidence: a.confidence ?? null, time_ms: a.timeMs, mode: a.mode, attempted_at: a.attemptedAt })),
            { onConflict: 'id', ignoreDuplicates: true }, // a retried upload is ignored, never counted twice
          ),
        ),
      ),

    async deleteRows(items) {
      const keys = (table: OutboxItem['table']) => items.filter((i) => i.table === table).map((i) => i.key)
      const byIn = async (table: 'bookmarks' | 'question_notes', ids: string[]): Promise<Result> =>
        chunks(ids, (part) => write(() => client.from(table).delete().eq('user_id', userId).in('question_id', part)))
      const a = await byIn('bookmarks', keys('bookmarks'))
      if (!a.ok) return a
      const b = await byIn('question_notes', keys('question_notes'))
      if (!b.ok) return b
      for (const k of keys('flags')) {
        const cut = k.lastIndexOf('|')
        const questionId = k.slice(0, cut)
        const reason = k.slice(cut + 1)
        const r = await write(() => client.from('flags').delete().eq('user_id', userId).eq('question_id', questionId).eq('reason', reason))
        if (!r.ok) return r
      }
      return chunks(keys('bookmark_collections'), (part) => write(() => client.from('bookmark_collections').delete().eq('user_id', userId).in('id', part)))
    },
  }
}
