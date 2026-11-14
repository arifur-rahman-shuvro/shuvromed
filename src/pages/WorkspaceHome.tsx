import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, LinkButton, Skeleton } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useDailyGoal } from '../prefs/settings'
import { buildStats, dueList } from '../revision/engine'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { useSessionRepo, type WAttempt, type WSession } from '../session/repo'
import { plural, type WSubject } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const shortDay = (date: Date) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)

/** The first screen after sign-in: a visual, data-backed overview of the learner's private workspace. */
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
    setStatus('loading')
    const [w, q, s, a] = await Promise.all([ws.load(), qr.list(), sessions.list(), sessions.allAttempts()])
    if (w.error || !w.data || q.error || !q.data) { setStatus('error'); return }
    setSubjects(w.data.subjects.filter((x) => !x.archived))
    setQuestions(q.data)
    setList(s.data ?? [])
    setAttempts(a.data ?? [])
    setNow(new Date())
    setStatus('ready')
  }, [ws, qr, sessions])
  useEffect(() => { void load() }, [load, dataVersion])

  const info = useMemo(() => {
    const live = questions.filter((q) => !q.archived && !q.deleted)
    const liveIds = new Set(live.map((q) => q.id))
    const mine = attempts.filter((a) => liveIds.has(a.questionId) && a.outcome !== 'unanswered')
    const due = dueList(buildStats(attempts.filter((a) => liveIds.has(a.questionId))), now, liveIds)
    const correct = mine.filter((a) => a.outcome === 'correct').length
    const accuracy = mine.length ? Math.round((correct / mine.length) * 100) : null
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now)
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (6 - i))
      const key = dayKey(date)
      const count = mine.filter((a) => dayKey(new Date(a.attemptedAt)) === key).length
      return { key, label: shortDay(date), dateLabel: date.toLocaleDateString(), count }
    })
    const maxDay = Math.max(1, ...days.map((d) => d.count))
    const subjectStats = subjects.map((subject) => {
      const subjectQuestions = live.filter((q) => q.subjectId === subject.id)
      const ids = new Set(subjectQuestions.map((q) => q.id))
      const subjectAttempts = mine.filter((a) => ids.has(a.questionId))
      const right = subjectAttempts.filter((a) => a.outcome === 'correct').length
      return { ...subject, questionCount: subjectQuestions.length, attempts: subjectAttempts.length, accuracy: subjectAttempts.length ? Math.round((right / subjectAttempts.length) * 100) : null }
    }).sort((a, b) => b.questionCount - a.questionCount || a.name.localeCompare(b.name)).slice(0, 4)
    return {
      live: live.length, due: due.length, running: list.filter((s) => s.status === 'in_progress'), ran: list.length,
      answers: mine.length, correct, accuracy, days, maxDay, subjectStats,
    }
  }, [questions, subjects, attempts, list, now])

  const firstRun = status === 'ready' && (subjects.length === 0 || info.live === 0)
  const goal = 20
  const todayKey = dayKey(now)
  const answeredToday = info.days.find((d) => d.key === todayKey)?.count ?? 0
  const goalPct = Math.min(100, Math.round((answeredToday / goal) * 100))

  const steps = [
    { done: subjects.length > 0, number: '01', title: 'Create your first subject', body: 'Organise your learning around Anatomy, Physiology, Biochemistry and more.', to: '/app/workspace/subjects', cta: 'Explore subjects' },
    { done: info.live > 0, number: '02', title: 'Build your question bank', body: 'Add questions manually or import a prepared question set.', to: '/app/workspace/questions/new', cta: 'Add questions', alt: { to: '/app/workspace/import', cta: 'Import questions' } },
    { done: info.ran > 0, number: '03', title: 'Start learning actively', body: 'Create a focused practice session or a timed exam.', to: '/app/workspace/practice', cta: 'Start practising' },
  ]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-brand">Clinical Aurora · Learning space</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Your workspace</h1>
          <p className="mt-1 text-sm text-muted">A clear picture of what you know—and what to learn next.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-muted">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
        </div>
      </header>
      {sync ? <SyncBar sync={sync} /> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading workspace" className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-28 sm:col-span-2" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your workspace.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}

      {status === 'ready' ? (
        <>
          {firstRun ? (
            <section aria-label="Getting started" className="overflow-hidden rounded-3xl border border-line bg-surface">
              <div className="grid gap-5 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand/15 via-surface to-surface p-5 sm:p-7 md:grid-cols-[1.1fr_.9fr] md:items-center">
                <div>
                  <span className="inline-flex rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-brand">Your private learning space</span>
                  <h2 className="mt-4 max-w-lg text-2xl font-bold tracking-tight sm:text-3xl">Build knowledge that stays with you.</h2>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-muted">Set up your subjects, add questions and turn active recall into a daily habit. Your workspace is private to your account.</p>
                </div>
                <div aria-hidden="true" className="relative mx-auto grid size-44 place-items-center sm:size-52">
                  <div className="absolute inset-2 rounded-full border border-brand/20" />
                  <div className="absolute inset-6 rounded-full border border-dashed border-brand/30" />
                  <div className="grid size-28 place-items-center rounded-[2rem] bg-brand text-5xl text-brandfg shadow-xl shadow-brand/20 sm:size-32">✳</div>
                  <span className="absolute right-2 top-5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold shadow-sm">Learn</span>
                  <span className="absolute bottom-4 left-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold shadow-sm">Revise</span>
                </div>
              </div>
              <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 sm:p-5">
                {steps.map((step) => (
                  <div key={step.number} className="rounded-2xl bg-bg p-4">
                    <p className="text-[10px] font-bold tracking-[.16em] text-brand">{step.number} · {step.done ? 'COMPLETE' : 'NEXT STEP'}</p>
                    <h3 className="mt-2 font-semibold">{step.title}</h3>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-muted">{step.body}</p>
                    {!step.done ? <div className="mt-3 flex flex-wrap gap-2"><LinkButton to={step.to}>{step.cta}</LinkButton>{step.alt ? <LinkButton variant="secondary" to={step.alt.to}>{step.alt.cta}</LinkButton> : null}</div> : <p className="mt-3 text-xs font-semibold text-success">Ready ✓</p>}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <>
              <section aria-label="Study overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_.8fr_.8fr_.8fr]">
                <Card className="relative overflow-hidden border-brand/20 bg-gradient-to-br from-brand/10 via-surface to-surface">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-xs font-semibold text-muted">Questions in your bank</p><p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">{info.live.toLocaleString()}</p><p className="mt-1 text-xs text-muted">Ready for active recall</p></div>
                    <div aria-hidden="true" className="grid size-14 place-items-center rounded-2xl bg-brand/10 text-2xl text-brand">▤</div>
                  </div>
                  <Link className="mt-4 inline-flex min-h-10 items-center text-xs font-bold text-brand hover:underline" to="/app/workspace/questions">Explore question bank <span aria-hidden="true" className="ml-1">↗</span></Link>
                  <div aria-hidden="true" className="absolute -bottom-12 -right-8 size-36 rounded-full border-[18px] border-brand/5" />
                </Card>
                <Card className="flex items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-2xl text-amber-600" aria-hidden="true">↻</div>
                  <div className="min-w-0"><p className="text-xs font-semibold text-muted">Due for revision</p><p className="text-3xl font-bold tabular-nums">{info.due}</p><Link className="text-xs font-semibold text-brand hover:underline" to="/app/workspace/revision">Review now ↗</Link></div>
                </Card>
                <Card className="flex items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sky-500/10 text-2xl text-sky-600" aria-hidden="true">✓</div>
                  <div className="min-w-0"><p className="text-xs font-semibold text-muted">Answers recorded</p><p className="text-3xl font-bold tabular-nums">{info.answers.toLocaleString()}</p><p className="text-xs text-muted">Across all sessions</p></div>
                </Card>
                <Card className="flex items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-2xl text-violet-600" aria-hidden="true">◎</div>
                  <div className="min-w-0"><p className="text-xs font-semibold text-muted">Accuracy</p><p className="text-3xl font-bold tabular-nums">{info.accuracy === null ? '—' : `${info.accuracy}%`}</p><p className="text-xs text-muted">{info.accuracy === null ? 'No answers yet' : 'Correct answers'}</p></div>
                </Card>
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.35fr_.85fr]">
                <Card className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-xs font-semibold text-muted">Consistency</p><h2 className="mt-1 text-lg font-bold tracking-tight">Your study activity</h2><p className="text-xs text-muted">Answered questions · last 7 days</p></div>
                    <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">{info.answers} total</span>
                  </div>
                  <div className="mt-6 grid h-36 grid-cols-7 items-end gap-2" role="img" aria-label={`Study activity for the last seven days: ${info.days.map((d) => `${d.label} ${d.count}`).join(', ')} answers`}>
                    {info.days.map((d) => (
                      <div key={d.key} className="flex h-full flex-col items-center justify-end gap-2">
                        <span className="text-[10px] font-semibold tabular-nums text-muted">{d.count || ''}</span>
                        <div className="flex h-24 w-full items-end overflow-hidden rounded-lg bg-surface2">
                          <div className="w-full rounded-lg bg-gradient-to-t from-brand to-brand/60 transition-[height]" style={{ height: `${d.count ? Math.max(8, (d.count / info.maxDay) * 100) : 0}%` }} />
                        </div>
                        <span className="text-[10px] font-medium text-muted">{d.label}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="flex flex-col">
                  <div><p className="text-xs font-semibold text-muted">Daily target</p><h2 className="mt-1 text-lg font-bold tracking-tight">Small steps, daily</h2></div>
                  <div className="my-auto flex items-center justify-center gap-5 py-5">
                    <div className="relative grid size-32 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--brand) ${goalPct * 3.6}deg, var(--surface-2) 0deg)` }}>
                      <div className="grid size-24 place-items-center rounded-full bg-surface text-center"><div><p className="text-2xl font-bold tabular-nums">{goalPct}%</p><p className="text-[10px] text-muted">completed</p></div></div>
                    </div>
                    <div><p className="text-2xl font-bold tabular-nums">{answeredToday}<span className="text-sm font-medium text-muted"> / {goal}</span></p><p className="text-xs text-muted">answers today</p><p className="mt-2 text-xs font-semibold text-brand">{Math.max(0, goal - answeredToday)} to go</p></div>
                  </div>
                  <LinkButton to="/app/workspace/practice" className="w-full">Start a session <span aria-hidden="true">→</span></LinkButton>
                </Card>
              </section>

              <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <Card>
                  <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-muted">Your curriculum</p><h2 className="mt-1 text-lg font-bold">Subjects</h2></div><Link className="text-xs font-bold text-brand hover:underline" to="/app/workspace/subjects">View all ↗</Link></div>
                  {info.subjectStats.length ? <div className="mt-4 flex flex-col gap-4">
                    {info.subjectStats.map((subject, i) => <div key={subject.id}>
                      <div className="mb-1.5 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className={`grid size-8 shrink-0 place-items-center rounded-xl text-xs font-bold ${['bg-brand/10 text-brand', 'bg-sky-500/10 text-sky-600', 'bg-violet-500/10 text-violet-600', 'bg-amber-500/10 text-amber-600'][i]}`}>{subject.name.slice(0, 1).toUpperCase()}</span><span className="truncate text-sm font-semibold">{subject.name}</span></div><span className="shrink-0 text-xs tabular-nums text-muted">{subject.questionCount} questions</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand" style={{ width: `${subject.accuracy ?? 0}%` }} /></div>
                      <p className="mt-1 text-[10px] text-muted">{subject.accuracy === null ? 'Not practised yet' : `${subject.accuracy}% accuracy · ${plural(subject.attempts, 'answer')}`}</p>
                    </div>)}
                  </div> : <p className="mt-4 text-sm text-muted">Your subjects will appear here when you add them.</p>}
                </Card>

                <Card>
                  <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-muted">Continue learning</p><h2 className="mt-1 text-lg font-bold">Pick up where you left off</h2></div><span aria-hidden="true" className="text-2xl text-brand">↗</span></div>
                  {info.running.length ? <ul className="mt-4 flex flex-col gap-2">{info.running.slice(0, 3).map((session) => <li key={session.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.title}</p><p className="text-xs text-muted">{session.questionIds.length} questions · In progress</p></div><Link className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brandfg hover:brightness-95" to={`/app/workspace/session/${session.id}`}>Resume</Link></li>)}</ul> : <div className="mt-4 rounded-2xl bg-bg p-5 text-center"><div aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand/10 text-2xl text-brand">▶</div><p className="mt-3 text-sm font-semibold">Ready for your next session?</p><p className="mt-1 text-xs text-muted">Build a focused practice set or sit a timed exam.</p><LinkButton className="mt-3" to="/app/workspace/practice">Build a session</LinkButton></div>}
                </Card>
              </section>
            </>
          )}
        </>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted"><span>Private to your account · Designed for focused clinical learning</span><Link className="font-semibold text-brand hover:underline" to="/app/workspace/health">Workspace health ↗</Link></footer>
    </div>
  )
}
