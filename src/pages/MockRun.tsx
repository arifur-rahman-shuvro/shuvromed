import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Badge, ErrorBox, ListSkeleton } from '../components/bits'
import { Button, Card } from '../components/ui'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { finishRun, goTo, remainingMs, setAnswer, toggleFlag, unansweredCount, type MockRun } from '../mock/mock'
import { completeActive, saveActive, useMock } from '../mock/store'
import { addAttempt } from '../practice/attempts'
import { presentQuestion } from '../practice/shuffle'
import { formatClock } from './PracticePlayer'

export default function MockRunPage() {
  const { user } = useAuth()
  const mock = useMock(user?.id)
  const cat = useCatalog()
  const qs = useQuestions(null)
  // Set while an exam is being handed in: clearing the exam in progress must not bounce the student
  // back to the setup page before the move to their result has happened.
  const finishing = useRef(false)
  if (!user) return null
  if (!mock.active) return finishing.current ? null : <Navigate to="/app/mock" replace />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || qs.status !== 'ready') return <ListSkeleton rows={3} />
  return <Exam key={mock.active.id} userId={user.id} finishing={finishing} run={mock.active} questions={qs.questions} topics={cat.catalog.taxonomy.topics} />
}

function Exam({ userId, run, questions, topics, finishing }: { userId: string; finishing: { current: boolean }; run: MockRun; questions: import('../content/schema').Question[]; topics: readonly import('../content/schema').Topic[] }) {
  const navigate = useNavigate()
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])
  const [now, setNow] = useState(() => Date.now())
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownAt = useRef(0)
  const done = useRef(false)
  useEffect(() => { shownAt.current = Date.now() }, [run.current])

  const remaining = remainingMs(run, new Date(now))
  const qid = run.questionIds[run.current]
  const question = byId.get(qid)
  const presented = useMemo(() => (question ? presentQuestion(question, { shuffleOptions: true, seed: run.seed }) : null), [question, run.seed])
  const topicName = (id: string) => topics.find((t) => t.id === id)?.name ?? id

  const update = (next: MockRun) => {
    const r = saveActive(userId, next)
    setError(r.ok ? null : (r.error ?? 'Could not save.'))
  }
  const spent = () => Math.max(0, Date.now() - shownAt.current)

  function finish(timedOut: boolean) {
    if (done.current) return
    done.current = true
    const { result, attempts } = finishRun(goTo(run, run.current, spent()), questions, new Date(), timedOut, () => crypto.randomUUID())
    let failed: string | null = null
    for (const a of attempts) {
      const r = addAttempt(userId, a)
      if (!r.ok) failed = r.error ?? 'Some answers could not be saved.'
    }
    finishing.current = true
    const saved = completeActive(userId, result)
    if (failed || !saved.ok) {
      finishing.current = false
      done.current = false
      setError(failed ?? saved.error ?? 'Could not save the result.')
      return
    }
    navigate(`/app/mock/result/${result.id}`, { replace: true })
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (remaining === 0) finish(true)
    // finish is stable for this render's run; the done ref prevents a second submission
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  if (!question || !presented) {
    return <ErrorBox message="A question in this exam is no longer in the question bank. You can finish with the questions that remain, or discard the exam from the Mock exam page." onRetry={() => finish(false)} />
  }
  const chosen = run.answers[qid]
  const flagged = run.flagged.includes(qid)
  const left = unansweredCount(run)
  const low = remaining <= 60_000

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold" data-testid="mock-progress">Question {run.current + 1} of {run.questionIds.length}</p>
        <p role="timer" aria-label="Time remaining" className={low ? 'font-bold text-danger' : 'text-muted'}>{formatClock(remaining)} left</p>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          {question.isDemo ? <Badge tone="demo">DEMO · unreviewed sample</Badge> : null}
          <Badge>{topicName(question.topicId)}</Badge>
          {flagged ? <Badge>Flagged for review</Badge> : null}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-3 whitespace-pre-line text-lg font-medium">{question.stem}</legend>
          {presented.options.map((o) => (
            <label key={o.label} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 ${chosen === o.id ? 'border-brand' : 'border-line'}`}>
              <input type="radio" name="mock-answer" value={o.id} checked={chosen === o.id} onChange={() => update(setAnswer(run, qid, o.id))} className="mt-1 size-5" />
              <span><strong>{o.label}.</strong> {o.text}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="ghost" disabled={!chosen} onClick={() => update(setAnswer(run, qid, null))}>Clear answer</Button>
          <Button variant="secondary" aria-pressed={flagged} onClick={() => update(toggleFlag(run, qid))}>{flagged ? 'Remove flag' : 'Flag for review'}</Button>
        </div>
      </Card>

      <nav aria-label="Question navigator" className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
        {run.questionIds.map((id, i) => {
          const a = Boolean(run.answers[id])
          const f = run.flagged.includes(id)
          return (
            <button key={id} type="button" onClick={() => update(goTo(run, i, spent()))} aria-current={i === run.current ? 'true' : undefined}
              aria-label={`Question ${i + 1}, ${a ? 'answered' : 'not answered'}${f ? ', flagged' : ''}`}
              className={`min-h-12 rounded-xl border text-sm font-medium ${i === run.current ? 'border-brand ring-2 ring-brand' : a ? 'border-success' : 'border-line'} ${f ? 'underline decoration-2' : ''}`}>
              {i + 1}{f ? '⚑' : ''}
            </button>
          )
        })}
      </nav>

      {error ? <p role="alert" className="text-danger">{error}</p> : null}

      {confirm ? (
        <div role="alertdialog" aria-labelledby="finish-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <p id="finish-title" className="font-semibold">Finish the exam?</p>
          <p className="text-muted">
            {left === 0 ? 'All questions are answered.' : `${left} unanswered ${left === 1 ? 'question counts' : 'questions count'} as wrong.`}
            {run.flagged.length ? ` ${run.flagged.length} flagged for review.` : ''} You cannot change answers afterwards.
          </p>
          <div className="flex gap-3">
            <Button onClick={() => finish(false)}>Finish and see results</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep working</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={run.current === 0} onClick={() => update(goTo(run, run.current - 1, spent()))}>Previous</Button>
          <Button variant="secondary" disabled={run.current === run.questionIds.length - 1} onClick={() => update(goTo(run, run.current + 1, spent()))}>Next</Button>
          <Button onClick={() => setConfirm(true)}>Finish exam</Button>
        </div>
      )}
    </div>
  )
}
