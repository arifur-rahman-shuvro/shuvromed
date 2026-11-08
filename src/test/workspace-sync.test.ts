import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRepo } from '../workspace/localRepo'
import { deleteIdbDatabase, openIdbBackend } from '../workspace/store/idb'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore } from '../workspace/store/store'
import type { TableSpec } from '../workspace/store/types'
import { SyncController } from '../workspace/sync/controller'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'

let t = 0
const clock = () => new Date(Date.UTC(2026, 10, 8, 13, 0, ++t)) // always later than the fake server's own timestamps
const LATER = '2026-11-08T23:00:00.000Z'
const mk = (backend = memoryBackend(), specs: TableSpec[] = WORKSPACE_TABLES) => new WorkspaceStore(backend, specs, clock)

let server: FakeServer
beforeEach(() => { t = 0; server = fakeServer() })

describe('store: local first', () => {
  it('saves on the device immediately and queues the change', async () => {
    const s = mk()
    const row = await s.create('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null })
    expect((await s.list('user_subjects')).map((r) => r.name)).toEqual(['Anatomy'])
    expect((await s.pending()).count).toBe(1)
    expect(row.id).toMatch(/[0-9a-f-]{36}/)
  })
  it('ignores columns a client may not write', async () => {
    const s = mk()
    const r = await s.create('user_subjects', { name: 'A', owner_id: 'evil', row_version: 99, updated_at: 'x' })
    expect(r.owner_id).toBeUndefined()
    await runWorkspaceSync(s, server)
    const saved = [...(server.tables.get('user_subjects')?.values() ?? [])][0]
    expect(saved.owner_id).toBe('me')
    expect(saved.row_version).toBe(1)
  })
  it('removing a row that never reached the server just forgets it', async () => {
    const s = mk()
    const r = await s.create('user_subjects', { name: 'Temp' })
    await s.remove('user_subjects', r.id)
    expect(await s.list('user_subjects')).toHaveLength(0)
    expect((await s.pending()).count).toBe(0)
    await runWorkspaceSync(s, server)
    expect(server.calls.filter((c) => c.startsWith('insert'))).toHaveLength(0)
  })
  it('serialises quick edits so none is lost', async () => {
    const s = mk()
    const r = await s.create('user_subjects', { name: 'A', description: null })
    await Promise.all([s.update('user_subjects', r.id, { name: 'B' }), s.update('user_subjects', r.id, { description: 'd' })])
    const got = await s.get('user_subjects', r.id)
    expect(got).toMatchObject({ name: 'B', description: 'd' })
  })
})

describe('sync: send and read', () => {
  it('sends new and edited rows, then reports nothing pending', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null })
    let rep = await runWorkspaceSync(s, server)
    expect(rep).toMatchObject({ pushed: 1, offline: false, errors: [] })
    expect((await s.pending()).count).toBe(0)
    await s.update('user_subjects', sub.id, { name: 'Gross anatomy' })
    rep = await runWorkspaceSync(s, server)
    expect(rep.pushed).toBe(1)
    expect(server.tables.get('user_subjects')?.get(sub.id)).toMatchObject({ name: 'Gross anatomy', row_version: 2 })
    expect((await s.get('user_subjects', sub.id))?.row_version).toBe(2)
  })
  it('a second device receives, edits and deletions', async () => {
    const a = mk(); const b = mk()
    const sub = await a.create('user_subjects', { name: 'Physio' })
    await runWorkspaceSync(a, server)
    await runWorkspaceSync(b, server)
    expect((await b.list('user_subjects')).map((r) => r.name)).toEqual(['Physio'])
    await a.update('user_subjects', sub.id, { name: 'Physiology' })
    await runWorkspaceSync(a, server)
    await runWorkspaceSync(b, server)
    expect((await b.list('user_subjects')).map((r) => r.name)).toEqual(['Physiology'])
    await a.remove('user_subjects', sub.id)
    await runWorkspaceSync(a, server)
    const rep = await runWorkspaceSync(b, server)
    expect(rep.removed).toBe(1)
    expect(await b.list('user_subjects')).toHaveLength(0)
  })
  it('sends parents before children and deletes children before parents', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'S' })
    const kid = await s.create('user_topics', { subject_id: sub.id, parent_id: null, name: 'Kid' }, 'zzzz') // sorts last by id on purpose
    const parent = await s.create('user_topics', { subject_id: sub.id, parent_id: null, name: 'Parent' }, 'aaaa')
    await s.update('user_topics', kid.id, { parent_id: parent.id })
    await runWorkspaceSync(s, server)
    expect(server.calls.filter((c) => c.startsWith('insert'))).toEqual(['insert user_subjects', 'insert user_topics', 'insert user_topics'])
    const order = [...(server.tables.get('user_topics')?.keys() ?? [])]
    expect(order).toEqual(['aaaa', 'zzzz'])
    server.calls.length = 0
    await s.remove('user_topics', 'zzzz'); await s.remove('user_topics', 'aaaa'); await s.remove('user_subjects', sub.id)
    await runWorkspaceSync(s, server)
    expect(server.calls.filter((c) => c.startsWith('remove'))).toEqual(['remove user_topics', 'remove user_topics', 'remove user_subjects'])
  })
})

describe('sync: newest edit wins', () => {
  it('keeps a newer local edit and sends it', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'A' })
    await runWorkspaceSync(s, server)
    server.external('user_subjects', sub.id, { name: 'Remote' }, '2026-11-08T12:30:00.000Z')
    await s.update('user_subjects', sub.id, { name: 'Local' }) // edited at 13:00, newer
    await runWorkspaceSync(s, server)
    expect(server.tables.get('user_subjects')?.get(sub.id)?.name).toBe('Local')
  })
  it('takes a newer server edit and drops the older local one', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'A' })
    await runWorkspaceSync(s, server)
    await s.update('user_subjects', sub.id, { name: 'Local' }) // 13:00
    server.external('user_subjects', sub.id, { name: 'Remote' }, LATER)
    await runWorkspaceSync(s, server)
    expect((await s.get('user_subjects', sub.id))?.name).toBe('Remote')
    expect((await s.pending()).count).toBe(0)
  })
  it('an edit made while sending is kept and sent next time', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'One' })
    const realInsert = server.insert.bind(server)
    server.insert = async (table, row) => { const r = await realInsert(table, row); await s.update('user_subjects', sub.id, { name: 'Two' }); return r }
    await runWorkspaceSync(s, server)
    expect((await s.get('user_subjects', sub.id))?.name).toBe('Two')
    expect((await s.pending()).count).toBe(1)
    server.insert = realInsert
    await runWorkspaceSync(s, server)
    expect(server.tables.get('user_subjects')?.get(sub.id)?.name).toBe('Two')
    expect((await s.pending()).count).toBe(0)
  })
  it('a row deleted elsewhere but edited here comes back', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'A' })
    await runWorkspaceSync(s, server)
    server.externalDelete('user_subjects', sub.id)
    await s.update('user_subjects', sub.id, { name: 'Edited' })
    await runWorkspaceSync(s, server)
    expect(server.tables.get('user_subjects')?.get(sub.id)?.name).toBe('Edited')
  })
})

describe('sync: failures never lose data', () => {
  it('offline: changes stay queued and go out later', async () => {
    const s = mk()
    await s.create('user_subjects', { name: 'A' })
    server.down = true
    const rep = await runWorkspaceSync(s, server)
    expect(rep.offline).toBe(true)
    expect((await s.pending()).count).toBe(1)
    expect(await s.list('user_subjects')).toHaveLength(1)
    server.down = false
    expect((await runWorkspaceSync(s, server)).pushed).toBe(1)
  })
  it('a failed read never deletes local rows', async () => {
    const s = mk()
    await s.create('user_subjects', { name: 'A' })
    await runWorkspaceSync(s, server)
    server.down = true
    await runWorkspaceSync(s, server)
    expect(await s.list('user_subjects')).toHaveLength(1)
  })
  it('a lost answer is recovered without a duplicate', async () => {
    const s = mk()
    const sub = await s.create('user_subjects', { name: 'A' })
    server.loseNextAck = true
    const first = await runWorkspaceSync(s, server)
    expect(first.offline).toBe(true)
    const second = await runWorkspaceSync(s, server)
    expect(second.errors).toEqual([])
    expect(server.tables.get('user_subjects')?.size).toBe(1)
    expect((await s.pending()).count).toBe(0)
    expect(sub.id).toBeTruthy()
  })
  it('a refused change is flagged, others still go out, and discarding restores the server copy', async () => {
    const s = mk()
    const ok = await s.create('user_subjects', { name: 'Fine' })
    const clash = await s.create('user_subjects', { name: 'Anatomy' })
    server.externalInsert('user_subjects', { name: 'anatomy' }) // another device already has this name
    const rep = await runWorkspaceSync(s, server)
    expect(rep.rejected).toBe(1)
    expect(rep.offline).toBe(false)
    expect(server.tables.get('user_subjects')?.get(ok.id)).toBeTruthy()
    let p = await s.pending()
    expect(p.rejected).toHaveLength(1)
    expect(p.rejected[0]).toMatchObject({ id: clash.id, label: 'Anatomy' })
    server.calls.length = 0
    await runWorkspaceSync(s, server)
    expect(server.calls.filter((c) => c.startsWith('insert'))).toHaveLength(0) // not retried forever
    expect(await s.discardRejected()).toBe(1)
    p = await s.pending()
    expect(p.count).toBe(0)
    expect((await s.list('user_subjects')).map((r) => r.name).sort()).toEqual(['Fine', 'anatomy'].sort())
  })
  it('editing a refused row clears the flag so it is tried again', async () => {
    const s = mk()
    const clash = await s.create('user_subjects', { name: 'Anatomy' })
    server.externalInsert('user_subjects', { name: 'anatomy' })
    await runWorkspaceSync(s, server)
    await s.update('user_subjects', clash.id, { name: 'Anatomy 2' })
    const rep = await runWorkspaceSync(s, server)
    expect(rep.rejected).toBe(0)
    expect((await s.pending()).count).toBe(0)
  })
})

describe('sync: cursor tables read only what changed', () => {
  const specs: TableSpec[] = [{ name: 'items', order: 1, mode: 'cursor', columns: ['title', 'deleted_at'] }]
  it('reads everything first, then only changes; a tombstone arrives as an update', async () => {
    const s = mk(memoryBackend(), specs)
    const a = server.externalInsert('items', { title: 'one' }, '2026-11-08T12:00:01.000Z')
    server.externalInsert('items', { title: 'two' }, '2026-11-08T12:00:02.000Z')
    await runWorkspaceSync(s, server)
    expect(await s.list('items')).toHaveLength(2)
    server.external('items', a.id, { deleted_at: '2026-11-08T12:10:00.000Z' }, '2026-11-08T12:10:00.000Z')
    const rep = await runWorkspaceSync(s, server)
    expect(rep.pulled).toBeGreaterThanOrEqual(1)
    expect((await s.get('items', a.id))?.deleted_at).toBe('2026-11-08T12:10:00.000Z')
    expect(await s.backend.getMeta('cursor/items')).toBe('2026-11-08T12:10:00.000Z')
  })
  it('does not treat an absent row as deleted', async () => {
    const s = mk(memoryBackend(), specs)
    const a = server.externalInsert('items', { title: 'one' }, '2026-11-08T12:00:01.000Z')
    await runWorkspaceSync(s, server)
    server.externalDelete('items', a.id)
    await runWorkspaceSync(s, server)
    expect(await s.list('items')).toHaveLength(1)
  })
})

describe('IndexedDB backend', () => {
  it('keeps data after reopening, tracks pending changes, and separates users', async () => {
    const factory = new IDBFactory()
    const b1 = await openIdbBackend('user-1', factory)
    const s1 = mk(b1)
    const r = await s1.create('user_subjects', { name: 'Kept' })
    b1.close()
    const again = mk(await openIdbBackend('user-1', factory))
    expect((await again.list('user_subjects')).map((x) => x.name)).toEqual(['Kept'])
    expect((await again.pending()).count).toBe(1)
    await runWorkspaceSync(again, server)
    expect((await again.pending()).count).toBe(0)
    expect(server.tables.get('user_subjects')?.has(r.id)).toBe(true)
    const other = mk(await openIdbBackend('user-2', factory))
    expect(await other.list('user_subjects')).toHaveLength(0)
    await again.backend.setMeta('x', { a: 1 })
    expect(await again.backend.getMeta('x')).toEqual({ a: 1 })
  })
  it('deleting the database removes everything', async () => {
    const factory = new IDBFactory()
    const b = await openIdbBackend('user-1', factory)
    await mk(b).create('user_subjects', { name: 'Gone' })
    b.close()
    await deleteIdbDatabase('user-1', factory)
    expect(await mk(await openIdbBackend('user-1', factory)).list('user_subjects')).toHaveLength(0)
  })
})

describe('local repo applies the same rules as the database', () => {
  it('rejects duplicate names, wrong parents and loops; refuses deleting content', async () => {
    const s = mk(); const repo = localWorkspaceRepo(s)
    const a = (await repo.createSubject('Anatomy', null)).data!
    const b = (await repo.createSubject('Physiology', null)).data!
    expect((await repo.createSubject(' anatomy ', null)).error).toMatch(/already used/)
    const t1 = (await repo.createTopic(a.id, null, 'T1')).data!
    const t2 = (await repo.createTopic(a.id, t1.id, 'T2')).data!
    expect((await repo.createTopic(b.id, t1.id, 'Bad')).error).toMatch(/same subject/)
    expect((await repo.updateTopic(t1.id, { parentId: t2.id })).error).toMatch(/ancestor/)
    expect((await repo.createTopic(a.id, t1.id, ' t2 ')).error).toMatch(/already used/)
    expect((await repo.subjectUse(a.id)).data).toEqual({ topics: 2, questions: 0 })
    expect((await repo.deleteSubject(a.id)).error).toMatch(/still has items/)
    expect((await repo.deleteTopic(t1.id)).error).toMatch(/still has items/)
    expect((await repo.deleteTopic(t2.id)).error).toBeNull()
  })
  it('counts questions once the question tables exist', async () => {
    const specs: TableSpec[] = [...WORKSPACE_TABLES, { name: 'user_questions', order: 3, mode: 'cursor', columns: ['subject_id', 'deleted_at'] }]
    const s = mk(memoryBackend(), specs); const repo = localWorkspaceRepo(s)
    const a = (await repo.createSubject('Anatomy', null)).data!
    await s.create('user_questions', { subject_id: a.id, deleted_at: null })
    await s.create('user_questions', { subject_id: a.id, deleted_at: '2026-11-08T00:00:00Z' }) // hidden ones do not block deleting
    expect((await repo.subjectUse(a.id)).data?.questions).toBe(1)
    expect((await repo.deleteSubject(a.id)).error).toMatch(/still has items/)
  })
})

describe('controller', () => {
  afterEach(() => { vi.useRealTimers() })
  it('waits for a burst of edits, then syncs once', async () => {
    vi.useFakeTimers()
    const s = mk(); const c = new SyncController(s, server, { debounceMs: 1000 })
    await s.create('user_subjects', { name: 'A' }); await s.create('user_subjects', { name: 'B' })
    expect(server.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1100)
    expect(server.calls.filter((x) => x.startsWith('insert'))).toHaveLength(2)
    expect(c.getSnapshot()).toMatchObject({ state: 'idle', pending: 0 })
    c.close()
  })
  it('reports offline, runs one sync at a time, and recovers', async () => {
    const s = mk(); let online = false
    const c = new SyncController(s, server, { online: () => online, debounceMs: 10 })
    await s.create('user_subjects', { name: 'A' })
    expect(await c.syncNow()).toBeNull()
    expect(c.getSnapshot().state).toBe('offline')
    online = true
    const [x, y] = await Promise.all([c.syncNow(), c.syncNow()])
    expect(x).toBe(y)
    await vi.waitFor(() => expect(c.getSnapshot().state).toBe('idle')) // the request made during the run triggers one follow-up run
    expect(server.calls.filter((k) => k.startsWith('insert'))).toHaveLength(1)
    expect(c.getSnapshot()).toMatchObject({ state: 'idle', pending: 0 })
    c.close()
  })
  it('bumps dataVersion only when a sync brought changes in', async () => {
    const s = mk(); const c = new SyncController(s, server)
    await c.syncNow()
    expect(c.getSnapshot().dataVersion).toBe(0)
    server.externalInsert('user_subjects', { name: 'Remote' })
    await c.syncNow()
    expect(c.getSnapshot().dataVersion).toBe(1)
    c.close()
  })
  it('is "off" without a server', async () => {
    const c = new SyncController(mk(), null)
    expect(c.getSnapshot().state).toBe('off')
    expect(await c.syncNow()).toBeNull()
  })
})
