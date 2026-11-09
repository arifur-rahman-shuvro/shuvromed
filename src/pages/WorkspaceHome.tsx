import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, LinkButton, Skeleton } from '../components/ui'
import { buildStats, dueList } from '../revision/engine'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { useSessionRepo, type WAttempt, type WSession } from '../session/repo'
import { plural, type WSubject } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

/** The first screen after sign-in: a guide on an empty workspace, otherwise what to do next. */
export default function WorkspaceHome() {
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [list, setList] = useState<WSession[]>([])
  const [attempts, setAttempts] = useState<WAttempt[]>([])
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    const [w, q, s, a] = await Promise.all([ws.load(), qr.list(), sessions.list(), sessions.allAttempts()])
    if (w.error || !w.data || q.error || !q.data) { setStatus('error'); return }
    setSubjects(w.data.subjects.filter((x) => !x.archived)); setQuestions(q.data); setList(s.data ?? []); setAttempts(a.data ?? []); setNow(new Date()); setStatus('ready')
  }, [ws, qr, sessions])
  useEffect(() => { void load() }, [load, dataVersion])

  const info = useMemo(() => {
    const live = questions.filter((q) => !q.archived && !q.deleted)
    const liveIds = new Set(live.map((q) => q.id))
    const due = dueList(buildStats(attempts.filter((a) => liveIds.has(a.questionId))), now, liveIds).length
    return { live: live.length, due, running: list.filter((s) => s.status === 'in_progress'), ran: list.length }
  }, [questions, attempts, list, now])

  const steps = [
    { done: subjects.length > 0, title: 'Create a subject', body: 'A subject is a big area such as Anatomy. You can add topics inside it later.', to: '/app/workspace/subjects', cta: 'Open My subjects' },
    { done: info.live > 0, title: 'Add your questions', body: 'Write one yourself, or paste many at once with the import kit.', to: '/app/workspace/questions/new', cta: 'Add a question', alt: { to: '/app/workspace/import', cta: 'Import questions' } },
    { done: info.ran > 0, title: 'Practise or sit an exam', body: 'Choose which questions to use, how many, and whether to time it.', to: '/app/workspace/practice', cta: 'Open Practice and exams' },
  ]
  const firstRun = status === 'ready' && (subjects.length === 0 || info.live === 0)

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Home</h1>
      {sync ? <SyncBar sync={sync} /> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your workspace.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}

      {firstRun ? (
        <section aria-label="Getting started" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Welcome. Let's set up your question bank</h2>
          <p className="text-sm text-muted">Everything here is private to your account and works offline. Three steps:</p>
          <ol className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Card>
                  <p className="font-medium">Step {i + 1}: {s.title}{s.done ? ' (done)' : ''}</p>
                  <p className="text-sm text-muted">{s.body}</p>
                  {!s.done ? <div className="mt-2 flex flex-wrap gap-2"><LinkButton to={s.to}>{s.cta}</LinkButton>{s.alt ? <LinkButton variant="secondary" to={s.alt.to}>{s.alt.cta}</LinkButton> : null}</div> : null}
                </Card>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {status === 'ready' && !firstRun ? (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3">
            <Card><p className="text-2xl font-bold">{info.live}</p><p className="text-sm text-muted">{info.live === 1 ? 'question' : 'questions'}</p></Card>
            <Card><p className="text-2xl font-bold">{info.due}</p><p className="text-sm text-muted">due for revision</p></Card>
          </section>
          {info.running.length > 0 ? (
            <section aria-label="Unfinished sessions" className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Pick up where you left off</h2>
              <ul className="flex flex-col gap-2">
                {info.running.slice(0, 3).map((s) => (
                  <li key={s.id}><Card><p className="font-medium">{s.title}</p><Link className="mt-1 inline-flex min-h-11 items-center underline" aria-label={`Continue: ${s.title}`} to={`/app/workspace/session/${s.id}`}>Continue</Link></Card></li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <LinkButton to="/app/workspace/practice">Practice and exams</LinkButton>
            <LinkButton to="/app/workspace/revision" variant="secondary">{info.due > 0 ? `Revision (${plural(info.due, 'question')} due)` : 'Revision and insights'}</LinkButton>
            <LinkButton to="/app/workspace/questions/new" variant="secondary">Add a question</LinkButton>
          </div>
        </>
      ) : null}
      <p className="text-sm text-muted">Something looks wrong? <Link className="underline" to="/app/workspace/health">Check your data</Link>.</p>
    </div>
  )
}
