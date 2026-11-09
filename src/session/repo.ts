import { createContext, useContext } from 'react'
import type { Outcome } from '../questions/grade'
import type { WQuestion } from '../questions/repo'
import type { Response } from '../questions/ui/QuestionView'
import { normName } from '../workspace/model'
import type { Result } from '../workspace/repo'
import type { Change, Row, WorkspaceStore } from '../workspace/store/store'
import { versionToStamp } from './select'
import { MAX_SESSION_QUESTIONS, parseConfig, parseState, type SessionConfig, type SessionKind, type SessionState } from './types'
import type { Summary } from './score'

const SESSIONS = 'user_sessions'
const EXAMS = 'user_exams'
const ATTEMPTS = 'user_question_attempts'

export interface WSession {
  id: string
  kind: SessionKind
  examId: string | null
  title: string
  config: SessionConfig
  questionIds: string[]
  state: SessionState
  status: 'in_progress' | 'finished' | 'abandoned'
  startedAt: string
  finishedAt: string | null
  timeLimitSeconds: number | null
  /** Time spent so far (the clock only runs while the app is open). */
  elapsedMs: number
  result: Pick<Summary, 'score' | 'max' | 'correct' | 'incorrect' | 'partial' | 'unanswered'> | null
  hidden: boolean
}
export interface WExam { id: string; name: string; config: SessionConfig; archived: boolean }
export interface WAttempt {
  id: string
  questionId: string
  questionVersion: number
  response: Response | null
  score: number
  outcome: Outcome
  timeMs: number
  mode: 'practice' | 'exam' | 'revision'
  confidence: number | null
  sessionId: string | null
  attemptedAt: string
}
export interface AttemptInput {
  question: Pick<WQuestion, 'id' | 'version'>
  response: Response | null
  score: number
  outcome: Outcome
  timeMs: number
  confidence?: number | null
}

export interface SessionRepo {
  /** Starts a session on exactly these questions (their ids are fixed from now on). */
  start(input: { config: SessionConfig; questions: Pick<WQuestion, 'id'>[]; title: string; examId?: string | null }): Promise<Result<WSession>>
  get(id: string): Promise<Result<WSession>>
  list(opts?: { includeHidden?: boolean }): Promise<Result<WSession[]>>
  /** Saves where the learner is. Only a running session can be changed this way. */
  saveProgress(id: string, state: SessionState, elapsedMs: number): Promise<Result<WSession>>
  /** One answer in practice. */
  recordAttempt(sessionId: string, a: AttemptInput): Promise<Result<WAttempt>>
  /** Ends a session with its result. For an exam, pass every answer as `attempts` so they are saved together with the result. */
  finish(id: string, state: SessionState, elapsedMs: number, summary: Summary, attempts: AttemptInput[]): Promise<Result<WSession>>
  abandon(id: string, state: SessionState, elapsedMs: number): Promise<Result<WSession>>
  rename(id: string, title: string): Promise<Result<WSession>>
  setHidden(id: string, hidden: boolean): Promise<Result<WSession>>
  attempts(sessionId: string): Promise<Result<WAttempt[]>>
  /** Every answer ever recorded, oldest first. */
  allAttempts(): Promise<Result<WAttempt[]>>

  listExams(): Promise<Result<WExam[]>>
  createExam(name: string, config: SessionConfig): Promise<Result<WExam>>
  renameExam(id: string, name: string): Promise<Result<WExam>>
  setExamArchived(id: string, archived: boolean): Promise<Result<WExam>>
  removeExam(id: string): Promise<Result>
}

const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const bad = <T,>(error: string): Result<T> => ({ data: null, error })
const uuid = () => crypto.randomUUID()

const toSession = (r: Row): WSession => {
  const ids = Array.isArray(r.question_ids) ? (r.question_ids as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const finished = r.status === 'finished' && typeof r.score === 'number'
  return {
    id: r.id, kind: r.kind === 'exam' ? 'exam' : 'practice', examId: (r.exam_id as string | null) ?? null, title: String(r.title),
    config: parseConfig(r.config), questionIds: ids, state: parseState(r.state, ids.length),
    status: r.status === 'finished' || r.status === 'abandoned' ? r.status : 'in_progress',
    startedAt: String(r.started_at), finishedAt: (r.finished_at as string | null) ?? null, timeLimitSeconds: (r.time_limit_seconds as number | null) ?? null,
    elapsedMs: typeof r.elapsed_ms === 'number' ? r.elapsed_ms : 0,
    result: finished ? { score: Number(r.score), max: Number(r.max_score), correct: Number(r.correct), incorrect: Number(r.incorrect), partial: Number(r.partial), unanswered: Number(r.unanswered) } : null,
    hidden: r.hidden_at != null,
  }
}
const toAttempt = (r: Row): WAttempt => ({
  id: r.id, questionId: String(r.question_id), questionVersion: Number(r.question_version),
  response: r.response && typeof r.response === 'object' ? (r.response as Response) : null, score: Number(r.score), outcome: r.outcome as Outcome,
  timeMs: Number(r.time_ms ?? 0), confidence: typeof r.confidence === 'number' ? r.confidence : null, mode: (r.mode as WAttempt['mode']) ?? 'practice', sessionId: (r.session_id as string | null) ?? null, attemptedAt: String(r.attempted_at),
})
const toExam = (r: Row): WExam => ({ id: r.id, name: String(r.name), config: parseConfig(r.config), archived: r.archived_at != null })
const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Practice and exam sessions on the device. They sync like everything else; until migration M8 is applied they wait on the device. */
export function localSessionRepo(store: WorkspaceStore): SessionRepo {
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return bad(e instanceof Error ? e.message : 'Something went wrong.') }
  }
  const load = async (id: string): Promise<WSession> => toSession((await store.get(SESSIONS, id)) as Row)
  const running = async (id: string): Promise<{ row: Row } | { error: string }> => {
    const row = await store.get(SESSIONS, id)
    if (!row) return { error: 'That session no longer exists.' }
    if (row.status !== 'in_progress') return { error: 'This session has already ended.' }
    return { row }
  }
  const attemptRow = (sessionId: string, mode: 'practice' | 'exam' | 'revision', a: AttemptInput, at: string) => ({
    question_id: a.question.id, question_version: versionToStamp(a.question), response: clean(a.response ?? {}), score: a.score, max_score: 1,
    outcome: a.outcome, confidence: a.confidence && a.confidence >= 1 && a.confidence <= 5 ? Math.round(a.confidence) : null, time_ms: Math.min(86400000, Math.max(0, Math.round(a.timeMs))), mode, session_id: sessionId, attempted_at: at,
  })
  const checkExamName = async (name: string, selfId?: string): Promise<string | null> => {
    const n = name.trim()
    if (!n) return 'Write a name for the exam.'
    if (n.length > 80) return 'Keep the name to 80 characters or fewer.'
    if ((await store.list(EXAMS)).some((r) => r.id !== selfId && normName(String(r.name)) === normName(n))) return 'You already have an exam with that name.'
    return null
  }

  return {
    start: (input) => guard(async () => {
      const ids = [...new Set(input.questions.map((q) => q.id))]
      const title = input.title.trim()
      if (!ids.length) return bad('There are no questions to ask.')
      if (ids.length > MAX_SESSION_QUESTIONS) return bad(`A session can have at most ${MAX_SESSION_QUESTIONS} questions.`)
      if (!title || title.length > 120) return bad('Give the session a title of 1 to 120 characters.')
      const config = parseConfig({ ...input.config, count: ids.length })
      const limitSeconds = config.mode === 'exam' && config.timeLimitMinutes ? config.timeLimitMinutes * 60 : null
      const row = await store.create(SESSIONS, {
        kind: config.mode, exam_id: input.examId ?? null, title, config: clean(config), question_ids: ids, state: { index: 0, answers: {} }, status: 'in_progress',
        started_at: store.now(), finished_at: null, time_limit_seconds: limitSeconds, elapsed_ms: 0,
        score: null, max_score: null, correct: null, incorrect: null, partial: null, unanswered: null, hidden_at: null,
      })
      return ok(toSession(row))
    }),
    get: (id) => guard(async () => {
      const r = await store.get(SESSIONS, id)
      return r ? ok(toSession(r)) : bad('That session no longer exists.')
    }),
    list: (opts) => guard(async () => {
      const rows = (await store.list(SESSIONS)).map(toSession).filter((s) => opts?.includeHidden || !s.hidden)
      return ok(rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
    }),
    saveProgress: (id, state, elapsedMs) => guard(async () => {
      const r = await running(id)
      if ('error' in r) return bad(r.error)
      await store.update(SESSIONS, id, { state: clean(state), elapsed_ms: Math.min(172800000, Math.max(0, Math.round(elapsedMs))) })
      return ok(await load(id))
    }),
    recordAttempt: (sessionId, a) => guard(async () => {
      const r = await running(sessionId)
      if ('error' in r) return bad(r.error)
      const mode = r.row.kind === 'exam' ? 'exam' : parseConfig(r.row.config).revision ? 'revision' : 'practice'
      return ok(toAttempt(await store.create(ATTEMPTS, attemptRow(sessionId, mode, a, store.now()))))
    }),
    finish: (id, state, elapsedMs, summary, attempts) => guard(async () => {
      const r = await running(id)
      if ('error' in r) return bad(r.error)
      const at = store.now()
      const mode = r.row.kind === 'exam' ? 'exam' : parseConfig(r.row.config).revision ? 'revision' : 'practice'
      const changes: Change[] = attempts.map((a) => ({ table: ATTEMPTS, id: uuid(), create: attemptRow(id, mode, a, at) }))
      changes.push({
        table: SESSIONS, id,
        update: {
          status: 'finished', finished_at: at, state: clean(state), elapsed_ms: Math.min(172800000, Math.max(0, Math.round(elapsedMs))),
          score: summary.score, max_score: summary.max, correct: summary.correct, incorrect: summary.incorrect, partial: summary.partial, unanswered: summary.unanswered,
        },
      })
      await store.apply(changes)
      return ok(await load(id))
    }),
    abandon: (id, state, elapsedMs) => guard(async () => {
      const r = await running(id)
      if ('error' in r) return bad(r.error)
      await store.update(SESSIONS, id, { status: 'abandoned', state: clean(state), elapsed_ms: Math.min(172800000, Math.max(0, Math.round(elapsedMs))) })
      return ok(await load(id))
    }),
    rename: (id, title) => guard(async () => {
      const t = title.trim()
      if (!t || t.length > 120) return bad('Give the session a title of 1 to 120 characters.')
      if (!(await store.get(SESSIONS, id))) return bad('That session no longer exists.')
      await store.update(SESSIONS, id, { title: t })
      return ok(await load(id))
    }),
    setHidden: (id, hidden) => guard(async () => {
      if (!(await store.get(SESSIONS, id))) return bad('That session no longer exists.')
      await store.update(SESSIONS, id, { hidden_at: hidden ? store.now() : null })
      return ok(await load(id))
    }),
    allAttempts: () => guard(async () => ok((await store.list(ATTEMPTS)).map(toAttempt).sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt)))),
    attempts: (sessionId) => guard(async () => ok((await store.list(ATTEMPTS)).filter((r) => r.session_id === sessionId).map(toAttempt).sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt)))),

    listExams: () => guard(async () => ok((await store.list(EXAMS)).map(toExam).sort((a, b) => a.name.localeCompare(b.name)))),
    createExam: (name, config) => guard(async () => {
      const problem = await checkExamName(name)
      if (problem) return bad(problem)
      return ok(toExam(await store.create(EXAMS, { name: name.trim(), config: clean(parseConfig(config)), archived_at: null })))
    }),
    renameExam: (id, name) => guard(async () => {
      if (!(await store.get(EXAMS, id))) return bad('That exam no longer exists.')
      const problem = await checkExamName(name, id)
      if (problem) return bad(problem)
      return ok(toExam(await store.update(EXAMS, id, { name: name.trim() })))
    }),
    setExamArchived: (id, archived) => guard(async () => {
      if (!(await store.get(EXAMS, id))) return bad('That exam no longer exists.')
      return ok(toExam(await store.update(EXAMS, id, { archived_at: archived ? store.now() : null })))
    }),
    removeExam: (id) => guard(async () => {
      if (await store.get(EXAMS, id)) await store.remove(EXAMS, id) // past sessions keep their own copy of the settings
      return { data: null, error: null }
    }),
  }
}

export const SessionRepoContext = createContext<SessionRepo | null>(null)
const unavailable = <T,>(): Promise<Result<T>> => Promise.resolve(bad('Your workspace is not ready yet.'))
const notReady: SessionRepo = {
  start: unavailable, get: unavailable, list: unavailable, saveProgress: unavailable, recordAttempt: unavailable, finish: unavailable, abandon: unavailable,
  rename: unavailable, setHidden: unavailable, attempts: unavailable, allAttempts: unavailable, listExams: unavailable, createExam: unavailable, renameExam: unavailable, setExamArchived: unavailable, removeExam: unavailable,
}
export const useSessionRepo = (): SessionRepo => useContext(SessionRepoContext) ?? notReady
