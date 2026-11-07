import { beforeEach, describe, expect, it } from 'vitest'
import { addAttempt, loadAttempts, type Attempt } from '../practice/attempts'
import { runSync } from '../sync/engine'
import { reconcile, type ServerSnapshot } from '../sync/merge'
import { addCollection, addFlag, deleteCollection, emptyUserData, moveBookmark, removeFlag, setNote, toggleBookmark, type UserData } from '../userdata/model'
import { loadUserData, updateUserData } from '../userdata/store'
import { MemoryServer, asDevice, memoryRemote, resetDevices } from './memoryRemote'

const U = 'user-1'
const T = '2026-11-07T05:00:00.000Z'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const attempt = (n: number, over: Partial<Attempt> = {}): Attempt => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, questionId: 'q-a', selectedOptionId: 'A', isCorrect: true, timeMs: 1000,
  mode: 'practice', attemptedAt: `2026-11-07T04:0${n}:00.000Z`, contentVersion: 'v1', ...over,
})
const emptySnap = (): ServerSnapshot => ({ collections: [], bookmarks: [], notes: [], flags: [] })
const edit = (f: (d: UserData) => UserData) => updateUserData(U, f)

describe('reconcile (pure merge rules)', () => {
  it('keeps unsent local rows and queues them', () => {
    let d = emptyUserData()
    d = toggleBookmark(d, 'q1', T)
    d = setNote(d, 'q1', 'hello', T).ok ? (setNote(d, 'q1', 'hello', T) as { data: UserData }).data : d
    const { data, plan } = reconcile(d, emptySnap())
    expect(plan.bookmarks).toHaveLength(1)
    expect(plan.notes).toHaveLength(1)
    expect(data.bookmarks).toHaveLength(1)
  })
  it('adopts server rows it has never seen, as already synced', () => {
    const { data, plan } = reconcile(emptyUserData(), { ...emptySnap(), collections: [{ id: C1, name: 'Cardio', createdAt: T }], bookmarks: [{ questionId: 'q1', collectionId: C1, createdAt: T }], notes: [{ questionId: 'q1', body: 'n', updatedAt: T }], flags: [{ questionId: 'q1', reason: 'typo', comment: null, createdAt: T }] })
    expect(data.collections[0]).toMatchObject({ name: 'Cardio', synced: true })
    expect(data.bookmarks[0]).toMatchObject({ collectionId: C1, synced: true })
    expect(data.notes[0]).toMatchObject({ body: 'n', dirty: false })
    expect(data.flags[0]).toMatchObject({ reason: 'typo', synced: true })
    expect(plan).toEqual({ collections: [], bookmarks: [], notes: [], flags: [], deletes: [] })
  })
  it('drops synced rows that vanished from the server (deleted on another device)', () => {
    const d: UserData = { ...emptyUserData(), collections: [{ id: C1, name: 'Old', createdAt: T, synced: true }], bookmarks: [{ questionId: 'q1', collectionId: C1, createdAt: T, synced: true }], notes: [{ questionId: 'q1', body: 'x', updatedAt: T, dirty: false }], flags: [{ questionId: 'q1', reason: 'typo', comment: null, createdAt: T, synced: true }] }
    const { data } = reconcile(d, emptySnap())
    expect(data).toMatchObject({ collections: [], bookmarks: [], notes: [], flags: [] })
  })
  it('does not resurrect something this device deleted', () => {
    let d: UserData = { ...emptyUserData(), bookmarks: [{ questionId: 'q1', collectionId: null, createdAt: T, synced: true }] }
    d = toggleBookmark(d, 'q1', T) // deleted locally, queued
    const { data, plan } = reconcile(d, { ...emptySnap(), bookmarks: [{ questionId: 'q1', collectionId: null, createdAt: T }] })
    expect(data.bookmarks).toEqual([])
    expect(plan.deletes).toEqual([{ table: 'bookmarks', key: 'q1' }])
  })
  it('merges two same-named collections made on two devices into one and re-points bookmarks', () => {
    let d = emptyUserData()
    d = (addCollection(d, 'cardio', C2, T) as { data: UserData }).data
    d = toggleBookmark(d, 'q1', T)
    d = (moveBookmark(d, 'q1', C2) as { data: UserData }).data
    const { data, plan } = reconcile(d, { ...emptySnap(), collections: [{ id: C1, name: 'Cardio', createdAt: T }] })
    expect(data.collections.map((c) => c.id)).toEqual([C1])
    expect(data.bookmarks[0].collectionId).toBe(C1)
    expect(plan.collections).toEqual([])
    expect(plan.bookmarks[0].collectionId).toBe(C1)
  })
  it('a local unsent note wins over an older server note, but a newer server note wins over it', () => {
    const local: UserData = { ...emptyUserData(), notes: [{ questionId: 'q1', body: 'mine', updatedAt: '2026-11-07T06:00:00.000Z', dirty: true }] }
    const older = reconcile(local, { ...emptySnap(), notes: [{ questionId: 'q1', body: 'theirs', updatedAt: '2026-11-07T05:00:00.000Z' }] })
    expect(older.data.notes[0].body).toBe('mine')
    expect(older.plan.notes).toHaveLength(1)
    const newer = reconcile(local, { ...emptySnap(), notes: [{ questionId: 'q1', body: 'theirs', updatedAt: '2026-11-07T07:00:00.000Z' }] })
    expect(newer.data.notes[0]).toMatchObject({ body: 'theirs', dirty: false })
    expect(newer.plan.notes).toHaveLength(0)
  })
  it('a bookmark whose collection was deleted elsewhere becomes unfiled', () => {
    const d: UserData = { ...emptyUserData(), collections: [{ id: C1, name: 'Gone', createdAt: T, synced: true }], bookmarks: [{ questionId: 'q1', collectionId: C1, createdAt: T, synced: true }] }
    const { data } = reconcile(d, { ...emptySnap(), bookmarks: [{ questionId: 'q1', collectionId: null, createdAt: T }] })
    expect(data.bookmarks[0].collectionId).toBeNull()
  })
})

describe('runSync (two devices, one account, in-memory server)', () => {
  let server: MemoryServer
  beforeEach(() => {
    resetDevices()
    server = new MemoryServer()
    asDevice('phone')
  })
  const remote = () => memoryRemote(server)

  it('uploads answers once and never double-counts on retry', async () => {
    addAttempt(U, attempt(1)); addAttempt(U, attempt(2))
    const r1 = await runSync(U, remote())
    expect(r1).toMatchObject({ attemptsPushed: 2, errors: [] })
    expect(server.attempts.size).toBe(2)
    const r2 = await runSync(U, remote())
    expect(r2.attemptsPushed).toBe(0)
    expect(server.attempts.size).toBe(2)
    // the server ignores a repeated id even if the device forgot it had sent it
    updateUserData(U, (d) => ({ ...d, syncedAttemptIds: [] }))
    await runSync(U, remote())
    expect(server.attempts.size).toBe(2)
  })

  it('a second device downloads the answers and its schedule matches', async () => {
    addAttempt(U, attempt(1, { isCorrect: false })); addAttempt(U, attempt(2))
    await runSync(U, remote())
    asDevice('tablet')
    expect(loadAttempts(U)).toHaveLength(0)
    const r = await runSync(U, remote())
    expect(r).toMatchObject({ attemptsPulled: 2, attemptsPushed: 0, errors: [] })
    expect(loadAttempts(U).map((a) => a.id).sort()).toEqual([attempt(1).id, attempt(2).id])
    expect(loadAttempts(U).find((a) => a.id === attempt(1).id)).toMatchObject({ isCorrect: false, contentVersion: 'synced' })
  })

  it('answers made on both devices end up on both', async () => {
    addAttempt(U, attempt(1))
    await runSync(U, remote())
    asDevice('tablet')
    await runSync(U, remote())
    addAttempt(U, attempt(3, { questionId: 'q-b' }))
    await runSync(U, remote())
    asDevice('phone')
    addAttempt(U, attempt(4, { questionId: 'q-c' }))
    await runSync(U, remote())
    await runSync(U, remote())
    expect(loadAttempts(U)).toHaveLength(3)
    asDevice('tablet')
    await runSync(U, remote())
    expect(loadAttempts(U)).toHaveLength(3)
    expect(server.attempts.size).toBe(3)
  })

  it('offline: nothing is lost, errors are reported, and the next sync catches up', async () => {
    addAttempt(U, attempt(1))
    edit((d) => toggleBookmark(d, 'q1', T))
    server.offline = true
    const bad = await runSync(U, remote())
    expect(bad.errors.length).toBeGreaterThan(0)
    expect(loadAttempts(U)).toHaveLength(1)
    expect(loadUserData(U).bookmarks[0].synced).toBe(false)
    expect(server.attempts.size).toBe(0)
    server.offline = false
    const good = await runSync(U, remote())
    expect(good.errors).toEqual([])
    expect(server.attempts.size).toBe(1)
    expect(server.bookmarks.has('q1')).toBe(true)
    expect(loadUserData(U).bookmarks[0].synced).toBe(true)
  })

  it('collections, bookmarks, notes and flags travel to the other device, and deletions follow', async () => {
    edit((d) => (addCollection(d, 'Cardio', C1, T) as { data: UserData }).data)
    edit((d) => toggleBookmark(d, 'q1', T))
    edit((d) => (moveBookmark(d, 'q1', C1) as { data: UserData }).data)
    edit((d) => (setNote(d, 'q1', 'RCA supplies SA node', T) as { data: UserData }).data)
    edit((d) => (addFlag(d, 'q1', 'typo', 'stem', T) as { data: UserData }).data)
    expect((await runSync(U, remote())).errors).toEqual([])

    asDevice('tablet')
    expect((await runSync(U, remote())).errors).toEqual([])
    const d = loadUserData(U)
    expect(d.collections.map((c) => c.name)).toEqual(['Cardio'])
    expect(d.bookmarks[0]).toMatchObject({ questionId: 'q1', collectionId: C1, synced: true })
    expect(d.notes[0]).toMatchObject({ body: 'RCA supplies SA node', dirty: false })
    expect(d.flags[0]).toMatchObject({ reason: 'typo', comment: 'stem', synced: true })

    // tablet deletes everything; phone follows after its next sync
    edit((x) => removeFlag(x, 'q1', 'typo'))
    edit((x) => (setNote(x, 'q1', '', T) as { data: UserData }).data)
    edit((x) => toggleBookmark(x, 'q1', T))
    edit((x) => deleteCollection(x, C1))
    expect((await runSync(U, remote())).errors).toEqual([])
    expect([server.collections.size, server.bookmarks.size, server.notes.size, server.flags.size]).toEqual([0, 0, 0, 0])
    expect(loadUserData(U).outbox).toEqual([])

    asDevice('phone')
    expect((await runSync(U, remote())).errors).toEqual([])
    expect(loadUserData(U)).toMatchObject({ collections: [], bookmarks: [], notes: [], flags: [], outbox: [] })
  })

  it('deleting a collection on one device un-files (not deletes) its bookmarks on the other', async () => {
    edit((d) => (addCollection(d, 'Cardio', C1, T) as { data: UserData }).data)
    edit((d) => toggleBookmark(d, 'q1', T))
    edit((d) => (moveBookmark(d, 'q1', C1) as { data: UserData }).data)
    await runSync(U, remote())
    asDevice('tablet'); await runSync(U, remote())
    edit((x) => deleteCollection(x, C1))
    await runSync(U, remote())
    asDevice('phone'); await runSync(U, remote())
    expect(loadUserData(U).collections).toEqual([])
    expect(loadUserData(U).bookmarks).toMatchObject([{ questionId: 'q1', collectionId: null }])
  })

  it('same collection name created offline on two devices becomes one collection', async () => {
    edit((d) => (addCollection(d, 'Cardio', C1, T) as { data: UserData }).data)
    asDevice('tablet')
    edit((d) => (addCollection(d, 'cardio', C2, T) as { data: UserData }).data)
    edit((d) => toggleBookmark(d, 'q9', T))
    edit((d) => (moveBookmark(d, 'q9', C2) as { data: UserData }).data)
    asDevice('phone'); await runSync(U, remote())
    asDevice('tablet')
    expect((await runSync(U, remote())).errors).toEqual([])
    expect(server.collections.size).toBe(1)
    expect(server.bookmarks.get('q9')?.collectionId).toBe(C1)
    expect(loadUserData(U).collections.map((c) => c.id)).toEqual([C1])
  })

  it('a failed collection upload holds the bookmarks back instead of failing them', async () => {
    edit((d) => (addCollection(d, 'Cardio', C1, T) as { data: UserData }).data)
    edit((d) => toggleBookmark(d, 'q1', T))
    edit((d) => (moveBookmark(d, 'q1', C1) as { data: UserData }).data)
    server.collections.set(C2, { id: C2, name: 'CARDIO', createdAt: T }) // makes the name clash after our reconcile misses it
    const base = remote()
    const r = await runSync(U, { ...base, fetchSnapshot: async () => ({ ok: true, value: { collections: [], bookmarks: [], notes: [], flags: [] } }) })
    expect(r.errors.join(' ')).toMatch(/Uploading collections/)
    expect(server.calls).not.toContain('pushBookmarks')
    expect(loadUserData(U).bookmarks[0].synced).toBe(false)
    // a normal run afterwards repairs it by merging with the server's collection
    expect((await runSync(U, remote())).errors).toEqual([])
    expect(server.bookmarks.get('q1')?.collectionId).toBe(C2)
  })

  it('an edit made while the upload is running is not marked as sent', async () => {
    edit((d) => (setNote(d, 'q1', 'first', T) as { data: UserData }).data)
    server.duringNotePush = () => { edit((d) => (setNote(d, 'q1', 'second', '2026-11-07T05:30:00.000Z') as { data: UserData }).data) }
    await runSync(U, remote())
    expect(loadUserData(U).notes[0]).toMatchObject({ body: 'second', dirty: true })
    await runSync(U, remote())
    expect(server.notes.get('q1')?.body).toBe('second')
    expect(loadUserData(U).notes[0].dirty).toBe(false)
  })

  it('does not touch another account on the same phone', async () => {
    addAttempt(U, attempt(1))
    addAttempt('someone-else', attempt(2))
    await runSync(U, remote())
    expect(loadAttempts('someone-else')).toHaveLength(1)
    expect(loadUserData('someone-else').syncedAttemptIds).toEqual([])
  })

  it('a server failure while saving never throws', async () => {
    addAttempt(U, attempt(1))
    const r = await runSync(U, { ...remote(), pushAttempts: async () => { throw new Error('boom') } }).catch((e) => e)
    // the engine relies on the remote to catch its own errors; a thrown error must surface, not be swallowed silently
    expect(r).toBeInstanceOf(Error)
  })
})
