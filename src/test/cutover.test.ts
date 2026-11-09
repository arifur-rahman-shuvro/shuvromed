import { beforeEach, describe, expect, it } from 'vitest'
import { menuFor } from '../components/AppLayout'
import type { WQuestion } from '../questions/repo'
import { checkHealth, formatBytes, readStorage } from '../workspace/health'
import { getLegacyVisible, getWorkspaceEnabled, setLegacyVisible, setWorkspaceEnabled } from '../workspace/flag'

beforeEach(() => localStorage.clear())

describe('cutover switches', () => {
  it('the workspace is on by default, an explicit choice is remembered, and the old screens stay hidden by default', () => {
    expect(getWorkspaceEnabled('u')).toBe(true)
    setWorkspaceEnabled('u', false)
    expect(getWorkspaceEnabled('u')).toBe(false)
    expect(getWorkspaceEnabled('other')).toBe(true)
    setWorkspaceEnabled('u', true)
    expect(getWorkspaceEnabled('u')).toBe(true)
    expect(getLegacyVisible('u')).toBe(false)
    setLegacyVisible('u', true)
    expect(getLegacyVisible('u')).toBe(true)
  })
  it('the menu is the workspace; old screens appear only when asked for; off gives the old menu', () => {
    const labels = (on: boolean, legacy: boolean) => menuFor(on, legacy).map((n) => n.label)
    expect(labels(true, false)).toEqual(['Home', 'My subjects', 'My questions', 'Practice and exams', 'Revision and insights', 'My tags', 'Import / export', 'Data health', 'Settings'])
    expect(labels(true, true)).toContain('Old subjects')
    expect(labels(true, true)).toContain('Old analytics')
    expect(labels(true, true).at(-1)).toBe('Settings')
    expect(labels(false, false)).toContain('Dashboard')
    expect(labels(false, false)).not.toContain('Home')
  })
})

const q = (over: Partial<WQuestion> = {}): WQuestion => ({
  id: 'q1', subjectId: 's1', type: 'SBA', stem: 'Which valve?', difficulty: null,
  content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'a' }, explanation: null, reference: null,
  topicIds: [], tagIds: [], pendingEdit: false, version: 1, archived: false, deleted: false, updatedAt: '2026-11-10T00:00:00Z', ...over,
})
const base = { subjects: [{ id: 's1', name: 'Anatomy' }], topics: [{ id: 't1', name: 'Heart', subjectId: 's1', parentId: null }], tags: [{ id: 'g1', name: 'FCPS' }], sessions: [], attempts: [], now: new Date('2026-11-10T00:00:00Z') }

describe('data health check', () => {
  it('finds nothing in clean data', () => {
    expect(checkHealth({ ...base, questions: [q({ topicIds: ['t1'], tagIds: ['g1'] })] })).toEqual([])
  })
  it('finds invalid answer data, a missing subject, missing or foreign topics and missing tags', () => {
    const f = checkHealth({
      ...base,
      topics: [...base.topics, { id: 't2', name: 'Other', subjectId: 's2', parentId: null }, { id: 't3', name: 'Lost', subjectId: 'gone', parentId: null }],
      questions: [
        q({ id: 'a', stem: 'Bad content', content: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct_option_id: 'zzz' } }),
        q({ id: 'b', stem: 'No subject', subjectId: 'gone' }),
        q({ id: 'c', stem: 'Missing topic', topicIds: ['nope'] }),
        q({ id: 'd', stem: 'Foreign topic', topicIds: ['t2'] }),
        q({ id: 'e', stem: 'Missing tag', tagIds: ['nope'] }),
      ],
    })
    const ids = f.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['invalid-question', 'no-subject', 'topic-missing', 'topic-other-subject', 'tag-missing', 'topic-orphan']))
    expect(f.find((x) => x.id === 'invalid-question')?.examples).toEqual(['Bad content'])
    expect(f.every((x) => x.severity === 'problem')).toBe(true)
  })
  it('ignores deleted questions and reports leftovers as notes', () => {
    const f = checkHealth({
      ...base,
      questions: [q({ deleted: true, subjectId: 'gone' })],
      attempts: [{ id: 'a1', questionId: 'missing' }],
      sessions: [
        { id: 's', title: 'Old run', status: 'in_progress', startedAt: '2026-09-01T00:00:00Z', questionIds: ['missing'] },
        { id: 't', title: 'Recent', status: 'in_progress', startedAt: '2026-11-09T00:00:00Z', questionIds: ['q1'] },
      ],
    })
    expect(f.map((x) => x.id).sort()).toEqual(['attempt-orphan', 'old-unfinished', 'session-orphan'])
    expect(f.every((x) => x.severity === 'note')).toBe(true)
    expect(f.find((x) => x.id === 'old-unfinished')?.examples).toEqual(['Old run'])
  })
})

describe('storage reading', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
  it('returns unknowns when the browser cannot tell, and values when it can', async () => {
    expect(await readStorage(undefined)).toEqual({ usedBytes: null, quotaBytes: null, persistent: null })
    const nav = { storage: { estimate: async () => ({ usage: 1000, quota: 4000 }), persisted: async () => true } } as unknown as Navigator
    expect(await readStorage(nav)).toEqual({ usedBytes: 1000, quotaBytes: 4000, persistent: true })
    const failing = { storage: { estimate: async () => { throw new Error('x') }, persisted: async () => false } } as unknown as Navigator
    expect(await readStorage(failing)).toEqual({ usedBytes: null, quotaBytes: null, persistent: false })
  })
})
