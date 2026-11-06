import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTopicTree, descendantIds, flattenTree } from '../content/tree'
import { createContentClient } from '../data/loader'
import { addAttempt, loadAttempts, newAttemptId, resetAttemptCache, type Attempt } from '../practice/attempts'
import { isCorrect, summarize, timeLimitMs, type SessionAnswer } from '../practice/scoring'
import { DEFAULT_CONFIG, clampCount, matchingQuestions, selectQuestions } from '../practice/session'
import { hashSeed, mulberry32, presentQuestion, shuffled } from '../practice/shuffle'
import { topicStats } from '../practice/stats'
import { bundleFetcher, realBundle, realContent } from './content'

const content = realContent()
const questions = content.questions
const topics = content.topics

function attempt(questionId: string, correct: boolean, at: string, over: Partial<Attempt> = {}): Attempt {
  return {
    id: newAttemptId(),
    questionId,
    selectedOptionId: 'A',
    isCorrect: correct,
    timeMs: 5000,
    mode: 'practice',
    attemptedAt: at,
    contentVersion: 'v1',
    ...over,
  }
}

describe('topic tree', () => {
  it('nests anatomy as Thorax > Heart > (Coronary arteries, Cardiac chambers and valves)', () => {
    const tree = buildTopicTree(topics, 'anatomy')
    expect(tree.map((n) => n.topic.id)).toEqual(['anatomy-thorax'])
    const heart = tree[0].children[0]
    expect(heart.topic.id).toBe('anatomy-heart')
    expect(heart.children.map((c) => c.topic.id)).toEqual(['anatomy-coronary-arteries', 'anatomy-cardiac-chambers-valves'])
    expect(flattenTree(tree).map((n) => n.depth)).toEqual([0, 1, 2, 2])
  })
  it('descendantIds includes the topic and everything below it', () => {
    expect([...descendantIds(topics, 'anatomy-heart')].sort()).toEqual(
      ['anatomy-cardiac-chambers-valves', 'anatomy-coronary-arteries', 'anatomy-heart'],
    )
    expect([...descendantIds(topics, 'anatomy-coronary-arteries')]).toEqual(['anatomy-coronary-arteries'])
  })
  it('promotes a topic with a missing parent to a root instead of hiding it', () => {
    const orphan = topics.filter((t) => t.id !== 'anatomy-heart')
    const ids = buildTopicTree(orphan, 'anatomy').map((n) => n.topic.id).sort()
    expect(ids).toEqual(['anatomy-cardiac-chambers-valves', 'anatomy-coronary-arteries', 'anatomy-thorax'])
  })
  it('does not loop forever on a cyclic parent chain', () => {
    const a = { ...topics[0], id: 'cyc-a', parentId: 'cyc-b', subjectId: 'anatomy' }
    const b = { ...topics[0], id: 'cyc-b', parentId: 'cyc-a', subjectId: 'anatomy' }
    expect(() => buildTopicTree([a, b], 'anatomy')).not.toThrow()
  })
})

describe('shuffling', () => {
  const q = questions[0]
  it('is deterministic for a seed and different across seeds', () => {
    const a = presentQuestion(q, { shuffleOptions: true, seed: 's1' }).options.map((o) => o.id).join('')
    const b = presentQuestion(q, { shuffleOptions: true, seed: 's1' }).options.map((o) => o.id).join('')
    expect(a).toBe(b)
    const orders = new Set(Array.from({ length: 40 }, (_, i) => presentQuestion(q, { shuffleOptions: true, seed: `x${i}` }).options.map((o) => o.id).join('')))
    expect(orders.size).toBeGreaterThan(5)
  })
  it('keeps written order when shuffling is off', () => {
    expect(presentQuestion(q, { shuffleOptions: false, seed: 's' }).options.map((o) => o.id).join('')).toBe('ABCDE')
  })
  it('respects fixedOptionOrder', () => {
    const fixed = { ...q, fixedOptionOrder: true }
    expect(presentQuestion(fixed, { shuffleOptions: true, seed: 'any' }).options.map((o) => o.id).join('')).toBe('ABCDE')
  })
  it('never changes which option is correct, for every real question and 50 seeds', () => {
    for (const question of questions) {
      for (let i = 0; i < 50; i++) {
        const p = presentQuestion(question, { shuffleOptions: true, seed: `seed${i}` })
        expect(p.options.map((o) => o.id).sort()).toEqual(question.options.map((o) => o.id).sort())
        expect(p.options.map((o) => o.label).join('')).toBe('ABCDE'.slice(0, question.options.length))
        const shownCorrect = p.options.find((o) => o.label === p.correctLabel)!
        expect(shownCorrect.id).toBe(question.correctOptionId)
        expect(shownCorrect.text).toBe(question.options.find((o) => o.id === question.correctOptionId)!.text)
        expect(isCorrect(question, shownCorrect.id)).toBe(true)
      }
    }
  })
  it('shuffled() returns a permutation and does not mutate its input', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const out = shuffled(input, mulberry32(hashSeed('p')))
    expect([...out].sort()).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('scoring', () => {
  const ans = (id: string, ok: boolean, ms: number, topicId = 't1', difficulty: SessionAnswer['difficulty'] = 'easy'): SessionAnswer =>
    ({ questionId: id, topicId, subjectId: 's', difficulty, selectedOptionId: 'A', isCorrect: ok, timeMs: ms })
  it('scores a mixed session, counting skipped questions as not correct for the overall score', () => {
    const s = summarize([ans('a', true, 4000), ans('b', false, 6000, 't2', 'hard'), ans('c', true, 2000)], 5)
    expect(s).toMatchObject({ total: 5, answered: 3, correct: 2, incorrect: 1, skipped: 2 })
    expect(s.accuracyPct).toBeCloseTo(66.67, 1)
    expect(s.scorePct).toBe(40)
    expect(s.avgTimeMs).toBe(4000)
    expect(s.byTopic.t1).toMatchObject({ answered: 2, correct: 2, accuracyPct: 100 })
    expect(s.byTopic.t2).toMatchObject({ answered: 1, correct: 0, accuracyPct: 0 })
    expect(s.byDifficulty.hard.answered).toBe(1)
  })
  it('returns nulls, not NaN, when nothing was answered', () => {
    const s = summarize([], 4)
    expect(s).toMatchObject({ answered: 0, skipped: 4, accuracyPct: null, avgTimeMs: null, scorePct: 0 })
    expect(summarize([], 0).scorePct).toBeNull()
  })
  it('isCorrect compares to the stored correct option only', () => {
    expect(isCorrect(questions[0], questions[0].correctOptionId)).toBe(true)
    const wrong = questions[0].options.find((o) => o.id !== questions[0].correctOptionId)!.id
    expect(isCorrect(questions[0], wrong)).toBe(false)
  })
  it('timed practice allows 90 seconds per question', () => {
    expect(timeLimitMs(10)).toBe(900_000)
  })
})

describe('session selection', () => {
  const cfg = (o: Partial<typeof DEFAULT_CONFIG> = {}) => ({ ...DEFAULT_CONFIG, ...o })
  it('filters by subject, topic (including child topics), exam style and difficulty', () => {
    expect(matchingQuestions(questions, topics, cfg({ subjectId: 'anatomy' }), [])).toHaveLength(4)
    expect(matchingQuestions(questions, topics, cfg({ topicId: 'anatomy-heart' }), [])).toHaveLength(4)
    expect(matchingQuestions(questions, topics, cfg({ topicId: 'anatomy-coronary-arteries' }), [])).toHaveLength(3)
    expect(matchingQuestions(questions, topics, cfg({ examStyle: 'mrcs' }), []).map((q) => q.id)).toEqual(['demo-anat-cor-002'])
    expect(matchingQuestions(questions, topics, cfg({ difficulty: 'easy' }), []).every((q) => q.difficulty === 'easy')).toBe(true)
    expect(matchingQuestions(questions, topics, cfg(), [])).toHaveLength(questions.length)
  })
  it('incorrect-only uses the LATEST attempt; unattempted excludes anything answered', () => {
    const history = [
      attempt('demo-anat-cor-001', false, '2026-01-01T10:00:00Z'),
      attempt('demo-anat-cor-001', true, '2026-01-02T10:00:00Z'), // later and correct -> no longer "incorrect"
      attempt('demo-anat-cor-002', true, '2026-01-01T10:00:00Z'),
      attempt('demo-anat-cor-002', false, '2026-01-03T10:00:00Z'), // latest wrong -> incorrect
    ]
    expect(matchingQuestions(questions, topics, cfg({ mode: 'incorrect' }), history).map((q) => q.id)).toEqual(['demo-anat-cor-002'])
    const un = matchingQuestions(questions, topics, cfg({ mode: 'unattempted' }), history).map((q) => q.id)
    expect(un).not.toContain('demo-anat-cor-001')
    expect(un).not.toContain('demo-anat-cor-002')
    expect(un).toHaveLength(questions.length - 2)
  })
  it('limits to the requested count, clamps silly counts, and is reproducible per seed', () => {
    const a = selectQuestions(questions, topics, cfg({ count: 3 }), [], 'seedA').map((q) => q.id)
    const b = selectQuestions(questions, topics, cfg({ count: 3 }), [], 'seedA').map((q) => q.id)
    expect(a).toHaveLength(3)
    expect(a).toEqual(b)
    expect(selectQuestions(questions, topics, cfg({ count: 999 }), [], 's')).toHaveLength(questions.length)
    expect(clampCount(0)).toBe(1)
    expect(clampCount(NaN)).toBe(10)
    expect(clampCount(5000)).toBe(100)
  })
  it('without question shuffling the order is stable by id', () => {
    const ids = selectQuestions(questions, topics, cfg({ shuffleQuestions: false, count: 50 }), [], 'z').map((q) => q.id)
    expect(ids).toEqual([...ids].sort())
  })
  it('different seeds give different question orders', () => {
    const orders = new Set(Array.from({ length: 20 }, (_, i) => selectQuestions(questions, topics, cfg({ count: 8 }), [], `s${i}`).map((q) => q.id).join()))
    expect(orders.size).toBeGreaterThan(3)
  })
})

describe('topic statistics', () => {
  const cor = questions.filter((q) => q.topicId === 'anatomy-coronary-arteries')
  it('counts, accuracy, mastery, difficulty mix and exam styles', () => {
    const h = [
      attempt('demo-anat-cor-001', false, '2026-01-01T10:00:00Z'),
      attempt('demo-anat-cor-001', true, '2026-01-02T10:00:00Z'),
      attempt('demo-anat-cor-002', false, '2026-01-02T10:00:00Z'),
      attempt('demo-phys-cycle-001', true, '2026-01-02T10:00:00Z'), // other topic: ignored
    ]
    const s = topicStats(cor, h)
    expect(s.questionCount).toBe(3)
    expect(s.attemptedQuestions).toBe(2)
    expect(s.attempts).toBe(3)
    expect(s.accuracyPct).toBeCloseTo(33.33, 1)
    expect(s.masteryPct).toBeCloseTo(33.33, 1) // only cor-001's latest answer is correct, of 3 questions
    expect(s.difficultyMix).toEqual({ easy: 1, medium: 2, hard: 0 })
    expect(s.examStyles).toEqual(['mbbs', 'mrcs', 'plab', 'ukmla', 'usmle'])
  })
  it('gives null (not 0) when there is nothing to measure', () => {
    expect(topicStats(cor, []).accuracyPct).toBeNull()
    expect(topicStats([], []).masteryPct).toBeNull()
    expect(topicStats(cor, []).masteryPct).toBe(0)
  })
})

describe('attempt store (this device)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetAttemptCache()
    vi.restoreAllMocks()
  })
  it('persists across a cache reset, i.e. survives a reload', () => {
    const a = attempt('demo-anat-cor-001', true, '2026-01-01T10:00:00Z')
    expect(addAttempt('user-1', a)).toEqual({ ok: true })
    resetAttemptCache()
    expect(loadAttempts('user-1')).toEqual([a])
  })
  it('ignores a duplicate submission of the same attempt id', () => {
    const a = attempt('demo-anat-cor-001', true, '2026-01-01T10:00:00Z')
    addAttempt('user-1', a)
    addAttempt('user-1', a)
    expect(loadAttempts('user-1')).toHaveLength(1)
  })
  it('keeps each signed-in user separate on a shared device', () => {
    addAttempt('user-1', attempt('demo-anat-cor-001', true, '2026-01-01T10:00:00Z'))
    expect(loadAttempts('user-2')).toEqual([])
  })
  it('drops corrupt entries but keeps the valid ones', () => {
    const good = attempt('demo-anat-cor-001', true, '2026-01-01T10:00:00Z')
    localStorage.setItem('shuvromed.attempts.v1.user-1', JSON.stringify([good, { nonsense: true }, 42]))
    expect(loadAttempts('user-1')).toEqual([good])
  })
  it('survives wholly unparseable storage', () => {
    localStorage.setItem('shuvromed.attempts.v1.user-1', '{not json')
    expect(loadAttempts('user-1')).toEqual([])
  })
  it('rejects invalid attempts', () => {
    const bad = { ...attempt('x', true, '2026-01-01T10:00:00Z'), timeMs: -5 }
    expect(addAttempt('user-1', bad).ok).toBe(false)
    expect(loadAttempts('user-1')).toEqual([])
  })
  it('reports a failure instead of pretending it saved when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const r = addAttempt('user-1', attempt('demo-anat-cor-001', true, '2026-01-01T10:00:00Z'))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/save progress/i)
    expect(loadAttempts('user-1')).toEqual([])
  })
})

describe('content loader', () => {
  const bundle = realBundle()
  it('loads the catalogue and one subject, validating with the shared schemas', async () => {
    const client = createContentClient(bundleFetcher(bundle))
    const { manifest, taxonomy } = await client.loadCatalog()
    expect(manifest.totalQuestions).toBe(8)
    expect(taxonomy.subjects).toHaveLength(15)
    expect((await client.loadSubjectQuestions('anatomy')).map((q) => q.id)).toHaveLength(4)
  })
  it('returns an empty list for a subject with no shipped questions', async () => {
    expect(await createContentClient(bundleFetcher(bundle)).loadSubjectQuestions('surgery')).toEqual([])
  })
  it('fetches each file once and then serves it from memory', async () => {
    const calls: string[] = []
    const client = createContentClient(bundleFetcher(bundle, calls))
    await client.loadSubjectQuestions('anatomy')
    await client.loadSubjectQuestions('anatomy')
    await client.loadCatalog()
    expect(calls.filter((c) => c.startsWith('questions/anatomy'))).toHaveLength(1)
    expect(calls.filter((c) => c === 'manifest.json')).toHaveLength(1)
  })
  it('puts the content version on question URLs so a new release is never served stale', async () => {
    const calls: string[] = []
    await createContentClient(bundleFetcher(bundle, calls)).loadSubjectQuestions('anatomy')
    expect(calls).toContain(`questions/anatomy.json?v=${bundle.manifest.contentVersion}`)
  })
  it('rejects a corrupted question file with a validation error, then recovers on retry', async () => {
    let corrupt = true
    const good = bundleFetcher(bundle)
    const client = createContentClient(async (path) => {
      const data = await good(path)
      if (corrupt && path.startsWith('questions/anatomy')) return [{ ...(data as object[])[0], correctOptionId: 'Z' }]
      return data
    })
    await expect(client.loadSubjectQuestions('anatomy')).rejects.toThrow()
    corrupt = false
    await expect(client.loadSubjectQuestions('anatomy')).resolves.toHaveLength(4)
  })
  it('recovers after a network failure on the catalogue', async () => {
    let down = true
    const good = bundleFetcher(bundle)
    const client = createContentClient(async (p) => {
      if (down) throw new Error('offline')
      return good(p)
    })
    await expect(client.loadCatalog()).rejects.toThrow('offline')
    down = false
    await expect(client.loadCatalog()).resolves.toBeTruthy()
  })
})
