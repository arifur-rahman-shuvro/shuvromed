import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, Skeleton } from '../components/ui'
import { shuffled } from '../questions/registry'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import type { MultipleContent, SbaContent } from '../questions/schema'
import AnswerArea, { type Option } from '../questions/ui/AnswerArea'
import AnswerFeedback from '../questions/ui/AnswerFeedback'
import { useSessionRepo, type WSession } from '../session/repo'
import { formatDuration, gradeAnswer, summarize } from '../session/score'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'

const OUT = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', unanswered: 'Not answered' } as const

/** The result of a finished session, with every question open for review. */
export default function WorkspaceSessionResult() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const sessions = useSessionRepo()
  const qr = useQuestionRepo()
  const ws = useWorkspaceRepo()
  const navigate = useNavigate()
  const [session, setSession] = useState<WSession | null>(null)
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [subjects, setSubjects] = useState<Map<string, string>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [open, setOpen] = useState<string | null>(null)
  const [only, setOnly] = useState<'all' | 'wrong'>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      const [s, all, w] = await Promise.all([sessions.get(id), qr.list(), ws.load()])
      if (!live) return
      if (s.error || !s.data || all.error || !all.data || w.error || !w.data) { setStatus('error'); return }
      const byId = new Map(all.data.map((q) => [q.id, q]))
      setSession(s.data)
      setQuestions(s.data.questionIds.map((qid) => byId.get(qid)).filter((q): q is WQuestion => !!q))
      setSubjects(new Map(w.data.subjects.map((x) => [x.id, x.name])))
      setStatus('ready')
    })()
    return () => { live = false }
  }, [enabled, id, sessions, qr, ws])

  const summary = useMemo(() => (session ? summarize(questions, session.state.answers) : null), [session, questions])
  if (!enabled) return <Navigate to="/app/settings" replace />
  if (status === 'loading') return <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div>
  if (status === 'error' || !session || !summary) return <Card><p role="alert">This session could not be opened.</p><Link className="underline" to="/app/workspace/sessions">Back to sessions</Link></Card>
  if (session.status === 'in_progress') return <Navigate to={`/app/workspace/session/${session.id}`} replace />

  const cfg = session.config
  const res = session.result ?? summary
  const outcomeOf = (q: WQuestion) => session.state.answers[q.id]?.outcome ?? 'unanswered'
  const wrong = questions.filter((q) => ['incorrect', 'partial', 'unanswered'].includes(outcomeOf(q)))
  const shown = only === 'wrong' ? wrong : questions
  const optionsFor = (q: WQuestion, i: number): Option[] => {
    if (q.type !== 'SBA' && q.type !== 'MULTIPLE_MCQ') return []
    const list = (q.content as SbaContent | MultipleContent).options
    return cfg.shuffleOptions ? shuffled(list, cfg.seed + i * 7919) : list
  }
  async function again() {
    setError(null)
    const r = await sessions.start({
      config: { ...cfg, mode: 'practice', feedback: 'immediate', timeLimitMinutes: null, count: wrong.length, sourceLabel: 'Questions I missed', seed: Math.floor(Math.random() * 2147483647) },
      questions: wrong, title: `Practice: missed from ${session!.title}`,
    })
    if (r.error || !r.data) return setError(r.error ?? 'Could not start.')
    navigate(`/app/workspace/session/${r.data.id}`)
  }
  const pct = res.max ? Math.round((res.score / res.max) * 1000) / 10 : 0

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight sm:text-3xl">{session.status === 'abandoned' ? 'Stopped session' : 'Result'}</h1>
        <Link className="underline" to="/app/workspace/sessions">Past sessions</Link>
        <Link className="underline" to="/app/workspace/practice">New session</Link>
      </div>
      <p className="text-sm text-muted">{session.title}</p>

      {session.status === 'abandoned' ? <p>This session was stopped before it was finished, so it has no score.</p> : (
        <Card className="border-brand/20 bg-brand/5 p-5 sm:p-7">
          <p className="text-4xl font-semibold tracking-tight tabular-nums text-brand" aria-label="Score">{res.score} / {res.max} ({pct}%)</p>
          <p className="mt-2 text-sm leading-6 text-ink">{res.correct} correct · {res.partial} partly correct · {res.incorrect} incorrect · {res.unanswered} not answered</p>
          <p className="mt-1 text-xs text-muted">Time: {formatDuration(session.elapsedMs)}{session.timeLimitSeconds ? ` of ${formatDuration(session.timeLimitSeconds * 1000)}` : ''}{!cfg.negativeMarking ? ' · negative marking was off' : ''}</p>
        </Card>
      )}

      {session.status === 'finished' && summary.bySubject.length > 1 ? (
        <section aria-label="By subject" className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">By subject</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {summary.bySubject.map((b) => <li key={b.subjectId} className="rounded-xl border border-line bg-surface p-3 text-sm"><p className="font-medium">{subjects.get(b.subjectId) ?? 'Subject'}</p><p className="mt-1 text-muted">{b.score} of {b.total} · {b.correct} correct</p></li>)}
          </ul>
        </section>
      ) : null}

      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      {wrong.length > 0 ? <div><Button onClick={() => void again()}>Practise the {plural(wrong.length, 'question')} I missed</Button></div> : null}

      <section aria-label="Review" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-base font-semibold tracking-tight">Review</h2>
          <button type="button" className="min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2" aria-pressed={only === 'wrong'} onClick={() => setOnly(only === 'wrong' ? 'all' : 'wrong')}>{only === 'wrong' ? 'Show all' : 'Show only missed'}</button>
        </div>
        <ul className="flex flex-col gap-2">
          {shown.map((q) => {
            const i = questions.indexOf(q)
            const a = session.state.answers[q.id]
            const o = outcomeOf(q)
            const isOpen = open === q.id
            return (
              <li key={q.id}>
                <Card className="border-line/90 transition-colors hover:border-brand/30">
                  <button type="button" className="w-full min-h-12 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : q.id)}>
                    <span className="text-sm text-muted">Question {i + 1} · {OUT[o]}</span>
                    <span className="mt-1 block line-clamp-2 text-sm font-medium leading-6 text-ink">{q.stem}</span>
                  </button>
                  {isOpen ? (
                    <div className="mt-3 flex flex-col gap-3">
                      <AnswerArea question={q} options={optionsFor(q, i)} response={a?.response ?? {}} onChange={() => undefined} done result={gradeAnswer(q, a?.response ?? null, cfg.negativeMarking).result} />
                      <AnswerFeedback question={q} result={gradeAnswer(q, a?.response ?? null, cfg.negativeMarking).result} negativeOff={!cfg.negativeMarking} />
                    </div>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
