import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { supabaseRemote } from '../sync/remote'

type Call = { table: string; steps: [string, unknown[]][] }

/** Records the exact request each method would send, and answers with canned rows or an error. */
function stub(answer: (c: Call) => { data?: unknown[]; error?: { message: string } | null } | Error) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, steps: [] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'gte', 'order', 'range', 'upsert', 'delete']) {
        chain[m] = (...args: unknown[]) => { call.steps.push([m, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        const a = answer(call)
        if (a instanceof Error) return reject(a)
        resolve({ data: a.data ?? null, error: a.error ?? null })
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { client, calls }
}
const step = (c: Call, name: string) => c.steps.find((s) => s[0] === name)?.[1]
const U = 'u-1'

describe('supabaseRemote request shapes', () => {
  it('attempts upload ignores duplicates by id, sends only the account\'s own id and the right columns', async () => {
    const { client, calls } = stub(() => ({ data: [] }))
    const r = await supabaseRemote(client, U).pushAttempts([
      { id: '00000000-0000-4000-8000-000000000001', questionId: 'q1', selectedOptionId: 'B', isCorrect: false, confidence: 4, timeMs: 900, mode: 'revision', attemptedAt: '2026-11-07T04:00:00.000Z', contentVersion: 'v1' },
    ])
    expect(r.ok).toBe(true)
    expect(calls[0].table).toBe('attempts')
    const [rows, opts] = step(calls[0], 'upsert') as [Record<string, unknown>[], unknown]
    expect(opts).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    expect(rows[0]).toEqual({ id: '00000000-0000-4000-8000-000000000001', user_id: U, question_id: 'q1', selected_option: 'B', is_correct: false, confidence: 4, time_ms: 900, mode: 'revision', attempted_at: '2026-11-07T04:00:00.000Z' })
    expect(JSON.stringify(rows)).not.toContain('contentVersion')
  })
  it('uploads in chunks of 200', async () => {
    const { client, calls } = stub(() => ({ data: [] }))
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, questionId: 'q', selectedOptionId: 'A' as const, isCorrect: true, timeMs: 1, mode: 'practice' as const, attemptedAt: '2026-11-07T04:00:00.000Z', contentVersion: 'v' }))
    await supabaseRemote(client, U).pushAttempts(rows)
    expect(calls.map((c) => (step(c, 'upsert') as unknown[][])[0].length)).toEqual([200, 200, 50])
  })
  it('reads flags only for this user (admins can read everyone\'s) and every table by user', async () => {
    const { client, calls } = stub(() => ({ data: [] }))
    await supabaseRemote(client, U).fetchSnapshot()
    expect(calls.map((c) => c.table).sort()).toEqual(['bookmark_collections', 'bookmarks', 'flags', 'question_notes'])
    for (const c of calls) expect(step(c, 'eq')).toEqual(['user_id', U])
  })
  it('bookmarks and notes upsert on (user, question); flags ignore duplicates', async () => {
    const { client, calls } = stub(() => ({ data: [] }))
    const r = supabaseRemote(client, U)
    await r.pushBookmarks([{ questionId: 'q1', collectionId: null, createdAt: '2026-11-07T04:00:00.000Z' }])
    await r.pushNotes([{ questionId: 'q1', body: 'n' }])
    await r.pushFlags([{ questionId: 'q1', reason: 'typo', comment: null, createdAt: '2026-11-07T04:00:00.000Z' }])
    expect(step(calls[0], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,question_id' })
    expect(step(calls[1], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,question_id' })
    expect(step(calls[2], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,question_id,reason', ignoreDuplicates: true })
  })
  it('deletes are always scoped to the user and to the exact keys', async () => {
    const { client, calls } = stub(() => ({ data: [] }))
    await supabaseRemote(client, U).deleteRows([
      { table: 'bookmarks', key: 'q1' }, { table: 'question_notes', key: 'q2' },
      { table: 'flags', key: 'q3|typo' }, { table: 'bookmark_collections', key: 'c1' },
    ])
    expect(calls.map((c) => c.table)).toEqual(['bookmarks', 'question_notes', 'flags', 'bookmark_collections'])
    for (const c of calls) expect(c.steps.filter((s) => s[0] === 'eq')[0][1]).toEqual(['user_id', U])
    expect(calls[2].steps.filter((s) => s[0] === 'eq').map((s) => s[1])).toEqual([['user_id', U], ['question_id', 'q3'], ['reason', 'typo']])
  })
  it('maps downloaded rows and skips rows it cannot understand', async () => {
    const good = { id: '00000000-0000-4000-8000-000000000001', question_id: 'q1', selected_option: 'C', is_correct: true, confidence: null, time_ms: 5, mode: 'practice', attempted_at: '2026-11-07T04:00:00+00:00', created_at: '2026-11-07T04:00:01+00:00' }
    const { client, calls } = stub(() => ({ data: [good, { ...good, id: '00000000-0000-4000-8000-000000000002', selected_option: 'Z' }] }))
    const r = await supabaseRemote(client, U).fetchAttempts('2026-11-07T00:00:00.000Z')
    expect(r.ok && r.value).toHaveLength(1)
    expect(r.ok && r.value[0]).toMatchObject({ questionId: 'q1', attemptedAt: '2026-11-07T04:00:00.000Z', createdAt: '2026-11-07T04:00:01.000Z' })
    expect(r.ok && 'confidence' in r.value[0]).toBe(false)
    expect(step(calls[0], 'gte')).toEqual(['created_at', '2026-11-07T00:00:00.000Z'])
  })
  it('turns a server error and a dead network into a failed result instead of an exception', async () => {
    const a = await supabaseRemote(stub(() => ({ error: { message: 'permission denied' } })).client, U).pushNotes([{ questionId: 'q', body: 'b' }])
    expect(a).toEqual({ ok: false, error: 'permission denied' })
    const b = await supabaseRemote(stub(() => new Error('Failed to fetch')).client, U).fetchSnapshot()
    expect(b).toEqual({ ok: false, error: 'Failed to fetch' })
    const c = await supabaseRemote(stub(() => new Error('Failed to fetch')).client, U).pushAttempts([{ id: '00000000-0000-4000-8000-000000000001', questionId: 'q', selectedOptionId: 'A', isCorrect: true, timeMs: 1, mode: 'practice', attemptedAt: '2026-11-07T04:00:00.000Z', contentVersion: 'v' }])
    expect(c).toEqual({ ok: false, error: 'Failed to fetch' })
  })
  it('pages through more than 1000 rows', async () => {
    let n = 0
    const rows = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(n++ + i).padStart(12, '0')}`, name: 'c', created_at: '2026-11-07T04:00:00Z' }))
    const { client, calls } = stub((c) => (c.table === 'bookmark_collections' ? { data: rows(c.steps.some((s) => s[0] === 'range' && (s[1] as number[])[0] === 0) ? 1000 : 3) } : { data: [] }))
    const r = await supabaseRemote(client, U).fetchSnapshot()
    expect(r.ok && r.value.collections).toHaveLength(1003)
    expect(calls.filter((c) => c.table === 'bookmark_collections')).toHaveLength(2)
  })
})
