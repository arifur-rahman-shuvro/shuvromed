import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, Skeleton } from '../components/ui'
import { shuffled } from '../questions/registry'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import type { MultipleContent, SbaContent } from '../questions/schema'
import AnswerArea, { type Option, type Response } from '../questions/ui/AnswerArea'
import AnswerFeedback from '../questions/ui/AnswerFeedback'
import { useSessionRepo, type AttemptInput, type WSession } from '../session/repo'
import ConfidencePicker from '../session/ConfidencePicker'
import { formatClock, gradeAnswer, summarize } from '../session/score'
import type { AnswerRecord, SessionState } from '../session/types'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural } from '../workspace/model'

const hasAnswer = (r: Response | null | undefined): boolean => {
  if (!r) return false
  if (Array.isArray(r.selected)) return r.selected.length > 0
  if (typeof r.selected === 'string') return r.selected !== ''
  if (typeof r.value === 'boolean') return true
  return !!r.answers && Object.values(r.answers).some((v) => v.trim() !== '')
}
const optionsFor = (q: WQuestion, shuffle: boolean, seed: number): Option[] => {
  if (q.type !== 'SBA' && q.type !== 'MULTIPLE_MCQ') return []
  const list = (q.content as SbaContent | MultipleContent).options
  return shuffle ? shuffled(list, seed) : list
}
const btn = 'min-h-11 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/** Runs one practice or exam session. Progress is saved on the device as you go, so closing the app loses nothing. */
export default function WorkspaceSession() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const sessions = useSessionRepo()
  const qr = useQuestionRepo()
  const navigate = useNavigate()
  const [session, setSession] = useState<WSession | null>(null)
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [state, setState] = useState<SessionState>({ index: 0, answers: {} })
  const [elapsed, setElapsed] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(state)
  const baseRef = useRef({ at: Date.now(), ms: 0 })
  const qStart = useRef(Date.now())
  const finishing = useRef(false)
  stateRef.current = state

  const nowElapsed = () => baseRef.current.ms + (Date.now() - baseRef.current.at)

  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      const s = await sessions.get(id)
      const all = await qr.list()
      if (!live) return
      if (s.error || !s.data || all.error || !all.data) { setStatus('error'); return }
      const byId = new Map(all.data.map((q) => [q.id, q]))
      setSession(s.data)
      setQuestions(s.data.questionIds.map((qid) => byId.get(qid)).filter((q): q is WQuestion => !!q))
      setState(s.data.state)
      baseRef.current = { at: Date.now(), ms: s.data.elapsedMs }
      qStart.current = Date.now()
      setElapsed(s.data.elapsedMs)
      setStatus('ready')
    })()
    return () => { live = false }
  }, [enabled, id, sessions, qr])

  const cfg = session?.config
  const exam = session?.kind === 'exam'
  const limitMs = exam && cfg?.timeLimitMinutes ? cfg.timeLimitMinutes * 60000 : null

  /** Adds the time spent on the current question to its record. */
  const withTime = (s: SessionState): SessionState => {
    const q = questions[s.index]
    if (!q) return s
    const spent = Date.now() - qStart.current
    qStart.current = Date.now()
    const a = s.answers[q.id] ?? { response: null, ms: 0 }
    return { ...s, answers: { ...s.answers, [q.id]: { ...a, ms: a.ms + spent } } }
  }
  const save = useCallback(async () => {
    if (!session || session.status !== 'in_progress' || finishing.current) return
    const next = withTime(stateRef.current)
    setState(next); stateRef.current = next
    await sessions.saveProgress(session.id, next, nowElapsed())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessions, questions])

  useEffect(() => {
    if (status !== 'ready' || !session || session.status !== 'in_progress') return
    const tick = setInterval(() => setElapsed(nowElapsed()), 1000)
    const auto = setInterval(() => void save(), 10000)
    const hide = () => { if (document.visibilityState === 'hidden') void save() }
    document.addEventListener('visibilitychange', hide)
    return () => { clearInterval(tick); clearInterval(auto); document.removeEventListener('visibilitychange', hide) }
  }, [status, session, save])

  const attemptsFor = (s: SessionState): AttemptInput[] =>
    questions.map((q) => {
      const a = s.answers[q.id]
      const g = gradeAnswer(q, a?.response ?? null, cfg?.negativeMarking ?? true)
      return { question: q, response: hasAnswer(a?.response) ? a?.response ?? null : null, score: g.score, outcome: g.outcome, timeMs: a?.ms ?? 0, confidence: hasAnswer(a?.response) ? a?.confidence ?? null : null }
    })

  const submit = useCallback(async (abandon = false) => {
    if (!session || finishing.current) return
    finishing.current = true; setBusy(true); setError(null)
    let s = withTime(stateRef.current)
    if (abandon) {
      const r = await sessions.abandon(session.id, s, nowElapsed())
      if (r.error) { finishing.current = false; setBusy(false); return setError(r.error) }
      return navigate('/app/workspace/sessions')
    }
    // Grade everything that is not graded yet (exam: all; practice: unanswered ones count as unanswered).
    const answers: Record<string, AnswerRecord> = { ...s.answers }
    for (const q of questions) {
      const a = answers[q.id] ?? { response: null, ms: 0 }
      if (a.outcome) continue
      const g = gradeAnswer(q, a.response, cfg?.negativeMarking ?? true)
      answers[q.id] = { ...a, score: g.score, outcome: g.outcome }
    }
    s = { ...s, answers }
    const summary = summarize(questions, answers)
    const attempts = exam ? attemptsFor(s) : []
    const r = await sessions.finish(session.id, s, nowElapsed(), summary, attempts)
    if (r.error) { finishing.current = false; setBusy(false); return setError(r.error) }
    navigate(`/app/workspace/session/${session.id}/result`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessions, questions, exam, cfg, navigate])

  // Time is up: submit what there is.
  const timeUp = limitMs !== null && elapsed >= limitMs
  useEffect(() => { if (timeUp && status === 'ready' && session?.status === 'in_progress') void submit() }, [timeUp, status, session, submit])

  const q = questions[state.index]
  const rec: AnswerRecord = (q && state.answers[q.id]) || { response: null, ms: 0 }
  const checked = rec.outcome !== undefined
  const options = useMemo(() => (q && cfg ? optionsFor(q, cfg.shuffleOptions, cfg.seed + state.index * 7919) : []), [q, cfg, state.index])

  if (!enabled) return <Navigate to="/app/settings" replace />
  if (status === 'loading') return <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div>
  if (status === 'error' || !session || !cfg) return <Card><p role="alert">This session could not be opened.</p><Link className="underline" to="/app/workspace/sessions">Back to sessions</Link></Card>
  if (session.status !== 'in_progress') return <Navigate to={`/app/workspace/session/${session.id}/result`} replace />
  if (!q) return <Card><p>Its questions are no longer on this device.</p><Link className="underline" to="/app/workspace/sessions">Back to sessions</Link></Card>

  const total = questions.length
  const setResp = (response: Response) => setState((s) => ({ ...s, answers: { ...s.answers, [q.id]: { ...rec, response } } }))
  const go = (i: number) => { const t = withTime(state); setState({ ...t, index: Math.min(total - 1, Math.max(0, i)) }) }
  const flag = () => setState((s) => ({ ...s, answers: { ...s.answers, [q.id]: { ...rec, flagged: !rec.flagged } } }))
  const answered = questions.filter((x) => hasAnswer(state.answers[x.id]?.response)).length

  async function check() {
    const g = gradeAnswer(q, rec.response, cfg!.negativeMarking)
    const t = withTime({ ...state, answers: { ...state.answers, [q.id]: { ...rec, score: g.score, outcome: g.outcome } } })
    const a = t.answers[q.id]
    setState(t); stateRef.current = t
    const r = await sessions.recordAttempt(session!.id, { question: q, response: hasAnswer(rec.response) ? rec.response : null, score: g.score, outcome: g.outcome, timeMs: a.ms, confidence: hasAnswer(rec.response) ? rec.confidence ?? null : null })
    if (r.error) setError(r.error)
    await sessions.saveProgress(session!.id, t, nowElapsed())
  }
  const result = checked ? gradeAnswer(q, rec.response, cfg.negativeMarking).result : null
  const last = state.index === total - 1
  const unanswered = total - answered

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">{exam ? 'Assessment mode' : 'Learning mode'}</p><h1 className="text-xl font-semibold tracking-tight">{exam ? 'Exam' : 'Practice'}</h1></div>
        {limitMs !== null ? <p role="timer" aria-label="Time left" className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 font-mono text-sm font-semibold tabular-nums text-accent">{formatClock(limitMs - elapsed)}</p> : <p className="rounded-xl border border-line bg-surface2 px-3 py-2 font-mono text-sm tabular-nums text-muted" aria-label="Time spent">{formatClock(elapsed)}</p>}
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-medium text-muted">Question {state.index + 1} of {total} · {plural(answered, 'answered question')}{exam && rec.flagged ? ' · flagged for review' : ''}</p>
        <div role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={state.index + 1} className="h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${((state.index + 1) / total) * 100}%` }} /></div>
      </div>

      <Card className="border-line/90 p-4 shadow-sm sm:p-6"><AnswerArea question={q} options={options} response={rec.response ?? {}} onChange={setResp} done={!exam && checked} result={result} locked={!exam && checked} /></Card>

      {!checked || exam ? <ConfidencePicker value={rec.confidence} onChange={(confidence) => setState((s) => ({ ...s, answers: { ...s.answers, [q.id]: { ...rec, confidence } } }))} /> : null}
      {!exam && !checked ? <div><Button onClick={() => void check()}>Check answer</Button></div> : null}
      {!exam && checked && result ? <AnswerFeedback question={q} result={result} negativeOff={!cfg.negativeMarking} /> : null}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" className={btn} disabled={state.index === 0} onClick={() => go(state.index - 1)}>Previous</button>
        <button type="button" className={btn} disabled={last} onClick={() => go(state.index + 1)}>Next</button>
        {exam ? <button type="button" className={btn} aria-pressed={!!rec.flagged} onClick={flag}>{rec.flagged ? 'Remove flag' : 'Flag for review'}</button> : null}
        <Button variant={last ? 'primary' : 'secondary'} disabled={busy} onClick={() => (exam ? setConfirming(true) : void submit())}>{exam ? 'Submit exam' : 'Finish'}</Button>
        <button type="button" className={btn} onClick={() => void save().then(() => navigate('/app/workspace/sessions'))}>Pause and leave</button>
      </div>

      {exam ? (
        <nav aria-label="Questions" className="flex flex-wrap gap-1">
          {questions.map((x, i) => {
            const a = state.answers[x.id]
            const label = `Question ${i + 1}${hasAnswer(a?.response) ? ', answered' : ''}${a?.flagged ? ', flagged' : ''}`
            return <button key={x.id} type="button" aria-label={label} aria-current={i === state.index ? 'true' : undefined} onClick={() => go(i)}
              className={`size-11 rounded-lg border text-sm ${i === state.index ? 'border-accent font-bold' : 'border-line'} ${hasAnswer(a?.response) ? 'bg-surface2' : ''} ${a?.flagged ? 'underline decoration-2' : ''}`}>{i + 1}</button>
          })}
        </nav>
      ) : null}

      {confirming ? (
        <div role="group" aria-label="Confirm submit" className="rounded-xl border border-line bg-surface2 p-3">
          <p>Submit now? {unanswered ? `${plural(unanswered, 'question')} will be marked as not answered.` : 'All questions are answered.'} You cannot change answers after this.</p>
          <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void submit()}>Yes, submit</Button><Button variant="secondary" onClick={() => setConfirming(false)}>Keep working</Button></div>
        </div>
      ) : null}
      {stopping ? (
        <div role="group" aria-label="Confirm stop" className="rounded-xl border border-line bg-surface2 p-3">
          <p>Stop this session without a result? Answers already saved stay in your history.</p>
          <div className="mt-2 flex gap-2"><Button disabled={busy} onClick={() => void submit(true)}>Yes, stop</Button><Button variant="secondary" onClick={() => setStopping(false)}>Keep going</Button></div>
        </div>
      ) : <div><button type="button" className={btn} onClick={() => setStopping(true)}>Stop without a result</button></div>}
    </div>
  )
}
