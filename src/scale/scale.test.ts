import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { applyFilter, buildSearchIndex, EMPTY_FILTER } from '../bank/filter'
import { localQuestionRepo, type QuestionInput } from '../questions/repo'
import { buildStats, dueList, oftenWrong } from '../revision/engine'
import { totals, weakGroups, weeklyTrend } from '../revision/analytics'
import { gradeAnswer, summarize } from '../session/score'
import { chooseForConfig } from '../session/start'
import { localSessionRepo } from '../session/repo'
import { DEFAULT_CONFIG } from '../session/types'
import { localTagRepo } from '../tags/repo'
import { localWorkspaceRepo } from '../workspace/localRepo'
import { checkHealth } from '../workspace/health'
import { openIdbBackend } from '../workspace/store/idb'
import { memoryBackend } from '../workspace/store/memory'
import { WorkspaceStore, type Change } from '../workspace/store/store'
import { runWorkspaceSync } from '../workspace/sync/engine'
import { WORKSPACE_TABLES } from '../workspace/tables'
import { fakeServer } from '../test/memoryWorkspaceRemote'

/**
 * Phase 11 scale test: 20,000 questions and 20,000 saved answers through the real storage layer (IndexedDB), the real repositories,
 * the filter/session/revision/health code and a full sync to a second device. Timings are printed; limits are generous because
 * the test runs on a shared machine with a JavaScript IndexedDB, which is much slower than a phone's.
 */
const N = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SCALE_N ?? 20000)
const T: Record<string, number> = {}
const time = async <R,>(name: string, fn: () => Promise<R> | R): Promise<R> => { const t0 = performance.now(); const r = await fn(); T[name] = Math.round(performance.now() - t0); ;(globalThis as { process?: { stderr: { write(s: string): void } } }).process?.stderr.write(`${String(T[name]).padStart(8)} ms  ${name}\n`); return r }

describe(`${N.toLocaleString('en')} questions on one device`, () => {
  it('saves, lists, searches, practises, revises, checks and syncs to a second device', async () => {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
    const open = async () => (env.SCALE_BACKEND === 'memory' ? memoryBackend() : openIdbBackend('scale-user', new IDBFactory()))
    const store = new WorkspaceStore(await open(), WORKSPACE_TABLES)
    const ws = localWorkspaceRepo(store), qr = localQuestionRepo(store), tags = localTagRepo(store), sessions = localSessionRepo(store)

    // structure: 12 subjects x 10 topics, 6 tags
    const subjects: Awaited<ReturnType<typeof ws.createSubject>>['data'][] = []
    for (let i = 0; i < 12; i++) subjects.push((await ws.createSubject(`Subject ${i}`, null)).data)
    const topics: Record<string, string[]> = {}
    for (const s of subjects.map((x) => x!)) { topics[s.id] = []; for (let j = 0; j < 10; j++) topics[s.id].push((await ws.createTopic(s.id, null, `Topic ${s.name}-${j}`)).data!.id) }
    const tagIds: string[] = []
    for (let i = 0; i < 6; i++) tagIds.push((await tags.create(i < 3 ? 'exam' : 'general', `Tag ${i}`)).data!.id)

    const inputs: QuestionInput[] = Array.from({ length: N }, (_, i) => {
      const s = subjects[i % subjects.length]!
      const kind = i % 3
      return {
        subjectId: s.id, type: kind === 0 ? 'SBA' : kind === 1 ? 'TRUE_FALSE' : 'FILL_GAP', difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
        stem: kind === 2 ? `Statement number ${i} about the {{b1}} of ${i % 7 === 0 ? 'valve' : 'kidney'}` : `Statement number ${i} about ${i % 7 === 0 ? 'valve' : 'kidney'}`,
        content: kind === 0 ? { options: [{ id: 'a', text: `Right ${i}` }, { id: 'b', text: `Wrong ${i}` }, { id: 'c', text: `Other ${i}` }], correct_option_id: 'a' }
          : kind === 1 ? { correct_answer: i % 2 === 0 }
          : { blanks: [{ id: 'b1', accepted_answers: ['alpha', 'beta'] }] },
        explanation: `Because reason ${i}.`, reference: null, topicIds: [topics[s.id][i % 10]], tagIds: [tagIds[i % 6], tagIds[(i + 2) % 6]],
      } as QuestionInput
    })
    const made = await time('save 20,000 questions (createMany)', async () => (await qr.createMany(inputs)).data!)
    expect(made.created).toBe(N)
    expect(made.failed).toHaveLength(0)

    const all = await time('open the whole bank (list)', async () => (await qr.list()).data!)
    expect(all).toHaveLength(N)

    const wsData = (await ws.load()).data!
    const tagList = (await tags.list()).data!
    const ctx = { topics: wsData.topics, tags: tagList }
    const index = await time('build the search index', () => buildSearchIndex(all))
    const hits = await time('search "valve" with a tag and subject filter', () => applyFilter(all, { ...EMPTY_FILTER, text: 'valve', subjectIds: [subjects[1]!.id], generalTagIds: [tagIds[3]] }, { ...ctx, index }))
    expect(hits.length).toBeGreaterThan(0)

    // practice: pick 500 from the whole bank, start, answer, finish an exam
    const chosen = await time('choose 500 random questions from 20,000', () => chooseForConfig({ ...DEFAULT_CONFIG, mode: 'exam', count: 500, shuffleQuestions: true, seed: 42 }, all, ctx))
    expect(chosen.picked).toHaveLength(500)
    const started = (await time('start a 500-question session', () => sessions.start({ config: { ...DEFAULT_CONFIG, mode: 'exam', count: 500 }, questions: chosen.picked, title: 'Scale exam' }))).data!
    const answers: Record<string, { response: Record<string, unknown>; ms: number; outcome?: string; score?: number }> = {}
    for (const [i, q] of chosen.picked.entries()) {
      const r = q.type === 'SBA' ? { selected: i % 2 ? 'a' : 'b' } : q.type === 'TRUE_FALSE' ? { value: true } : { answers: { b1: 'alpha' } }
      const g = gradeAnswer(q, r as never, true)
      answers[q.id] = { response: r, ms: 5000, outcome: g.outcome, score: g.score }
    }
    const summary = summarize(chosen.picked, answers as never)
    const attempts = chosen.picked.map((q) => ({ question: q, response: answers[q.id].response as never, score: answers[q.id].score as number, outcome: answers[q.id].outcome as never, timeMs: 5000 }))
    await time('finish it (500 answers + result saved together)', async () => { const r = await sessions.finish(started.id, { index: 0, answers: answers as never }, 600000, summary, attempts); expect(r.error).toBeNull() })

    // 20,000 saved answers over 90 days
    const day = 86400000, now = Date.now()
    const changes: Change[] = all.map((q, i) => ({ table: 'user_question_attempts', id: crypto.randomUUID(), create: {
      question_id: q.id, question_version: 1, response: {}, score: i % 3 ? 1 : 0, max_score: 1, outcome: i % 3 ? 'correct' : 'incorrect', confidence: i % 5 ? (i % 5) + 1 : null,
      time_ms: 4000 + (i % 9) * 1000, mode: 'practice', session_id: null, attempted_at: new Date(now - (i % 90) * day).toISOString(),
    } }))
    await time('save 20,000 answers', async () => { for (let i = 0; i < changes.length; i += 1000) await store.apply(changes.slice(i, i + 1000)) })
    const att = await time('read all saved answers', async () => (await sessions.allAttempts()).data!)
    expect(att.length).toBeGreaterThanOrEqual(N)
    const due = await time('revision: build schedule, find due and often wrong', () => { const st = buildStats(att); return { due: dueList(st, new Date()).length, wrong: oftenWrong(st).length } })
    expect(due.due).toBeGreaterThan(0)
    await time('insights: totals, weakest topics, weekly trend', () => {
      const t = totals(att); const topicOf = new Map(all.map((q) => [q.id, q.topicIds]))
      weakGroups(att, (id) => topicOf.get(id) ?? []); weeklyTrend(att, new Date())
      return t
    })
    const health = await time('data health check over everything', async () => checkHealth({ subjects: wsData.subjects, topics: wsData.topics, tags: tagList, questions: all, sessions: (await sessions.list({ includeHidden: true })).data!, attempts: att, now: new Date() }))
    expect(health.filter((f) => f.severity === 'problem')).toEqual([])

    // send everything to the server, then bring it all to a second device
    const server = fakeServer()
    let inServer = 0
    for (const k of ['insertMany', 'insert', 'update'] as const) { const f = server[k].bind(server) as (...a: unknown[]) => Promise<unknown>; (server as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => { const t0 = performance.now(); const r = await f(...a); inServer += performance.now() - t0; return r } }
    const pushed = await time('sync up: send everything to the server', () => runWorkspaceSync(store, server))
    T['  (of which spent inside the stand-in server)'] = Math.round(inServer)
    ;(globalThis as { process?: { stderr: { write(s: string): void } } }).process?.stderr.write(`${String(T['  (of which spent inside the stand-in server)']).padStart(8)} ms  (of which spent inside the stand-in server)\n`)
    expect(pushed.errors).toEqual([])
    expect(server.tables.get('user_questions')?.size).toBe(N)
    expect(server.tables.get('user_question_attempts')?.size).toBe(att.length)
    const other = new WorkspaceStore(await open(), WORKSPACE_TABLES)
    const pulled = await time('sync down: a second device receives everything', () => runWorkspaceSync(other, server))
    expect(pulled.errors).toEqual([])
    expect((await localQuestionRepo(other).list()).data).toHaveLength(N)
    expect(((await localSessionRepo(other).allAttempts()).data ?? []).length).toBe(att.length)
    expect((await localQuestionRepo(other).list()).data!.every((q) => q.topicIds.length === 1 && q.tagIds.length === 2)).toBe(true)

    // changing one question later sends only that one
    const edit = all[123]
    await qr.update(edit.id, { subjectId: edit.subjectId, type: edit.type, stem: `${edit.stem} (edited)`, difficulty: edit.difficulty, content: edit.content, explanation: edit.explanation, reference: edit.reference, topicIds: edit.topicIds, tagIds: edit.tagIds })
    const small = await time('sync after one edit', () => runWorkspaceSync(store, server))
    expect(small.pushed).toBeLessThanOrEqual(2)

    console.log('\nSCALE RESULTS (milliseconds)\n' + Object.entries(T).map(([k, v]) => `${String(v).padStart(8)}  ${k}`).join('\n'))
    // Generous ceilings (JavaScript IndexedDB on a shared machine). The point is "minutes, not hours" and no step that grows badly.
    for (const [k, v] of Object.entries(T)) expect(v, k).toBeLessThan(240000)
    expect(T['build the search index']).toBeLessThan(5000)
    expect(T['search "valve" with a tag and subject filter']).toBeLessThan(1000)
    expect(T['revision: build schedule, find due and often wrong']).toBeLessThan(3000)
    expect(T['data health check over everything']).toBeLessThan(5000)
  })
})
