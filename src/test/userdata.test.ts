import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCollection, addFlag, deleteCollection, emptyUserData, moveBookmark, noteFor, removeFlag, setNote, toggleBookmark, NOTE_MAX, type Edit, type UserData,
} from '../userdata/model'
import { loadUserData, resetUserDataCache, saveUserData, updateUserData } from '../userdata/store'

const NOW = '2026-11-07T10:00:00.000Z'
const C1 = '11111111-1111-4111-8111-111111111111'
const data = (e: Edit): UserData => {
  if (!e.ok) throw new Error(e.error)
  return e.data
}

describe('bookmarks and collections', () => {
  it('toggles a bookmark on and off', () => {
    const on = toggleBookmark(emptyUserData(), 'q1', NOW)
    expect(on.bookmarks).toHaveLength(1)
    expect(toggleBookmark(on, 'q1', NOW).bookmarks).toHaveLength(0)
  })
  it('removing a bookmark that was never synced queues no server deletion; a synced one does', () => {
    const local = toggleBookmark(toggleBookmark(emptyUserData(), 'q1', NOW), 'q1', NOW)
    expect(local.outbox).toEqual([])
    const synced = { ...toggleBookmark(emptyUserData(), 'q1', NOW) }
    synced.bookmarks = synced.bookmarks.map((b) => ({ ...b, synced: true }))
    expect(toggleBookmark(synced, 'q1', NOW).outbox).toEqual([{ table: 'bookmarks', key: 'q1' }])
  })
  it('re-bookmarking cancels a pending server deletion', () => {
    const synced = toggleBookmark(emptyUserData(), 'q1', NOW)
    synced.bookmarks = synced.bookmarks.map((b) => ({ ...b, synced: true }))
    const removed = toggleBookmark(synced, 'q1', NOW)
    expect(toggleBookmark(removed, 'q1', NOW).outbox).toEqual([])
  })
  it('validates collection names (blank, too long, duplicate ignoring case)', () => {
    const d = emptyUserData()
    expect(addCollection(d, '   ', C1, NOW).ok).toBe(false)
    expect(addCollection(d, 'x'.repeat(61), C1, NOW).ok).toBe(false)
    const one = data(addCollection(d, '  Cardio   exam ', C1, NOW))
    expect(one.collections[0].name).toBe('Cardio exam')
    expect(addCollection(one, 'cardio EXAM', crypto.randomUUID(), NOW).ok).toBe(false)
  })
  it('moves a bookmark into a collection, refuses unknown collections and unbookmarked questions', () => {
    const base = data(addCollection(toggleBookmark(emptyUserData(), 'q1', NOW), 'A', C1, NOW))
    expect(data(moveBookmark(base, 'q1', C1)).bookmarks[0].collectionId).toBe(C1)
    expect(moveBookmark(base, 'q1', '22222222-2222-4222-8222-222222222222').ok).toBe(false)
    expect(moveBookmark(base, 'zzz', C1).ok).toBe(false)
  })
  it('deleting a collection keeps its bookmarks (unfiled) and queues the deletion if it was synced', () => {
    let d = data(addCollection(toggleBookmark(emptyUserData(), 'q1', NOW), 'A', C1, NOW))
    d = data(moveBookmark(d, 'q1', C1))
    d = { ...d, collections: d.collections.map((c) => ({ ...c, synced: true })) }
    const after = deleteCollection(d, C1)
    expect(after.collections).toEqual([])
    expect(after.bookmarks[0]).toMatchObject({ questionId: 'q1', collectionId: null, synced: false })
    expect(after.outbox).toEqual([{ table: 'bookmark_collections', key: C1 }])
  })
})

describe('notes', () => {
  it('saves, edits and trims a note', () => {
    const d1 = data(setNote(emptyUserData(), 'q1', '  remember this  ', NOW))
    expect(noteFor(d1, 'q1')).toMatchObject({ body: 'remember this', dirty: true })
    expect(noteFor(data(setNote(d1, 'q1', 'v2', NOW)), 'q1')?.body).toBe('v2')
    expect(d1.notes).toHaveLength(1)
  })
  it('an empty note deletes it and queues a server deletion', () => {
    const d1 = data(setNote(emptyUserData(), 'q1', 'x', NOW))
    const d2 = data(setNote(d1, 'q1', '   ', NOW))
    expect(d2.notes).toEqual([])
    expect(d2.outbox).toEqual([{ table: 'question_notes', key: 'q1' }])
  })
  it('refuses over-long notes without losing the old one', () => {
    const d1 = data(setNote(emptyUserData(), 'q1', 'keep', NOW))
    expect(setNote(d1, 'q1', 'x'.repeat(NOTE_MAX + 1), NOW).ok).toBe(false)
    expect(noteFor(d1, 'q1')?.body).toBe('keep')
  })
})

describe('flags', () => {
  it('adds a flag once per reason and removes it', () => {
    const d1 = data(addFlag(emptyUserData(), 'q1', 'typo', ' misspelt ', NOW))
    expect(d1.flags[0].comment).toBe('misspelt')
    expect(addFlag(d1, 'q1', 'typo', '', NOW).ok).toBe(false)
    expect(data(addFlag(d1, 'q1', 'unclear', '', NOW)).flags).toHaveLength(2)
    expect(removeFlag(d1, 'q1', 'typo').flags).toEqual([])
  })
  it('refuses a comment over 1000 characters', () => {
    expect(addFlag(emptyUserData(), 'q1', 'other', 'x'.repeat(1001), NOW).ok).toBe(false)
  })
})

describe('device storage', () => {
  beforeEach(() => {
    localStorage.clear()
    resetUserDataCache()
  })
  it('keeps each user separate and survives a reload', () => {
    updateUserData('u1', (d) => toggleBookmark(d, 'q1', NOW))
    expect(loadUserData('u2').bookmarks).toEqual([])
    resetUserDataCache()
    expect(loadUserData('u1').bookmarks).toHaveLength(1)
  })
  it('treats corrupt storage as empty instead of crashing', () => {
    localStorage.setItem('shuvromed.userdata.v1.u1', '{not json')
    expect(loadUserData('u1')).toEqual(emptyUserData())
    resetUserDataCache()
    localStorage.setItem('shuvromed.userdata.v1.u1', JSON.stringify({ bookmarks: 'nope' }))
    expect(loadUserData('u1')).toEqual(emptyUserData())
  })
  it('reports an edit error without changing stored data', () => {
    updateUserData('u1', (d) => toggleBookmark(d, 'q1', NOW))
    const r = updateUserData('u1', (d) => addCollection(d, '', C1, NOW))
    expect(r.ok).toBe(false)
    expect(loadUserData('u1').collections).toEqual([])
  })
  it('reports a visible error if the device refuses to store', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('quota') }
    try {
      expect(saveUserData('u1', emptyUserData()).ok).toBe(false)
    } finally {
      Storage.prototype.setItem = real
    }
  })
})
