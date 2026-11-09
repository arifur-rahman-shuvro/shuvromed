import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, Skeleton } from '../components/ui'
import { confidenceCalibration, totals, weakGroups, weeklyTrend } from '../revision/analytics'
import { buildStats, dueList, oftenWrong } from '../revision/engine'
import { stemPreview } from '../questions/registry'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { useSessionRepo, type WAttempt } from '../session/repo'
import { eligibleForSession } from '../session/select'
import { DEFAULT_CONFIG, MAX_SESSION_QUESTIONS } from '../session/types'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural, type WSubject, type WTopic } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const input = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'
const CONF = ['Guessing', 'Not sure', 'Fairly sure', 'Sure', 'Certain']

/** What to revise now, and where you are weak. Worked out from your saved answers; nothing extra is stored. */
export default function WorkspaceRevision() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const navigate = useNavigate()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [topics, setTopics] = useState<WTopic[]>([])
  const [attempts, setAttempts] = useState<WAttempt[]>([])
  const [count, setCount] = useState('20')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    const [w, q, a] = await Promise.all([ws.load(), qr.list(), sessions.allAttempts()])
    if (w.error || !w.data || q.error || !q.data || a.error || !a.data) { setStatus('error'); return }
    setSubjects(w.data.subjects); setTopics(w.data.topics); setQuestions(q.data); setAttempts(a.data); setNow(new Date()); setStatus('ready')
  }, [ws, qr, sessions])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  const data = useMemo(() => {
    const byId = new Map(questions.map((q) => [q.id, q]))
    const live = new Set(questions.filter((q) => !q.archived && !q.deleted).map((q) => q.id))
    const mine = attempts.filter((a) => byId.has(a.questionId))
    const stats = buildStats(mine)
    const sName = new Map(subjects.map((s) => [s.id, s.name]))
    const tName = new Map(topics.map((t) => [t.id, t.name]))
    const due = dueList(stats, now, live)
    const wrong = oftenWrong(stats, live)
    return {
      byId, mine, due, wrong, totals: totals(mine), conf: confidenceCalibration(mine), trend: weeklyTrend(mine, now),
      subj: weakGroups(mine, (id) => [byId.get(id)?.subjectId ?? '']).map((g) => ({ ...g, name: sName.get(g.key) ?? 'Subject' })).slice(0, 5),
      top: weakGroups(mine, (id) => byId.get(id)?.topicIds ?? []).map((g) => ({ ...g, name: tName.get(g.key) ?? 'Topic' })).slice(0, 5),
    }
  }, [questions, attempts, subjects, topics, now])

  if (!enabled) return <Navigate to="/app/settings" replace />

  async function start(label: string, ids: string[], n: number) {
    setError(null)
    const { eligible } = eligibleForSession(ids.map((id) => data.byId.get(id)).filter((q): q is WQuestion => !!q))
    const picked = eligible.slice(0, Math.min(n, MAX_SESSION_QUESTIONS))
    if (!picked.length) return setError('None of these questions can be used right now (an edit may still be syncing).')
    const r = await sessions.start({
      config: { ...DEFAULT_CONFIG, count: picked.length, shuffleQuestions: false, revision: true, sourceLabel: label, seed: Math.floor(Math.random() * 2147483647) },
      questions: picked, title: `Revision: ${label}`,
    })
    if (r.error || !r.data) return setError(r.error ?? 'Could not start.')
    navigate(`/app/workspace/session/${r.data.id}`)
  }
  const n = Math.floor(Number(count))
  const t = data.totals
  const maxWeek = Math.max(1, ...data.trend.map((w) => w.answers))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Revision and insights</h1>
        <Link className="underline" to="/app/workspace/practice">Practice and exams</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your answers.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}

      {status === 'ready' && t.answers === 0 ? <Card><p className="font-medium">No answers yet</p><p className="text-sm text-muted">Do a practice run or an exam first. Revision and insights are built from your answers.</p></Card> : null}

      {status === 'ready' && t.answers > 0 ? (
        <>
          <section aria-label="Due for revision" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Due for revision</h2>
            <p>{data.due.length === 0 ? 'Nothing is due right now.' : `${plural(data.due.length, 'question')} due now.`}</p>
            {data.due.length > 0 ? (
              <>
                <label className="flex flex-col gap-1 text-sm font-medium">How many to revise
                  <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))} />
                </label>
                <div><Button disabled={!(n >= 1)} onClick={() => void start('Due questions', data.due.map((d) => d.questionId), n)}>Start revision</Button></div>
              </>
            ) : null}
            <p className="text-sm text-muted">A right answer pushes a question further away (1, 2, 4, 8 ... days). A wrong answer brings it back the next day. A right answer marked as a guess does not move it forward.</p>
            {error ? <p role="alert" className="text-danger">{error}</p> : null}
          </section>

          <section aria-label="Overview" className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Overview</h2>
            <p>{plural(t.answers, 'answer')} on {plural(t.days, 'day')} · accuracy {t.accuracyPct}%{t.avgSeconds !== null ? ` · about ${t.avgSeconds}s per question` : ''}</p>
          </section>

          <section aria-label="Weak subjects and topics" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Where you are weakest</h2>
            {data.subj.length === 0 && data.top.length === 0 ? <p className="text-sm text-muted">Shown once a subject or topic has at least 5 answers.</p> : null}
            {data.subj.length > 0 ? <><h3 className="font-medium">Subjects</h3><ul className="text-sm">{data.subj.map((g) => <li key={g.key}>{g.name}: {g.accuracyPct}% ({plural(g.answers, 'answer')})</li>)}</ul></> : null}
            {data.top.length > 0 ? <><h3 className="font-medium">Topics</h3><ul className="text-sm">{data.top.map((g) => <li key={g.key}>{g.name}: {g.accuracyPct}% ({plural(g.answers, 'answer')})</li>)}</ul></> : null}
          </section>

          <section aria-label="Often wrong" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Often wrong</h2>
            {data.wrong.length === 0 ? <p className="text-sm text-muted">No question has been wrong twice or more yet.</p> : (
              <>
                <ul className="flex flex-col gap-2">
                  {data.wrong.slice(0, 10).map((s) => {
                    const q = data.byId.get(s.questionId)
                    return q ? (
                      <li key={s.questionId}><Card>
                        <p className="line-clamp-2">{stemPreview(q.stem, 120)}</p>
                        <p className="text-sm text-muted">Wrong {s.wrong} of {s.answers} times{s.overconfident ? `, ${s.overconfident} while sure` : ''}</p>
                        <div className="mt-1 flex gap-3 text-sm"><Link className="underline" to={`/app/workspace/questions/${q.id}`}>Edit</Link><Link className="underline" to={`/app/workspace/questions/${q.id}/history`}>History</Link></div>
                      </Card></li>
                    ) : null
                  })}
                </ul>
                <div><Button variant="secondary" onClick={() => void start('Often wrong', data.wrong.map((w) => w.questionId), 50)}>Practise the often wrong ones</Button></div>
              </>
            )}
          </section>

          <section aria-label="Confidence" className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Confidence</h2>
            {data.conf.rated === 0 ? <p className="text-sm text-muted">You have not rated how sure you were. Use the "How sure are you?" buttons while practising and this will show whether your confidence matches your results.</p> : (
              <>
                <ul className="text-sm">{data.conf.rows.filter((r) => r.answers > 0).map((r) => <li key={r.rating}>{CONF[r.rating - 1]}: {r.accuracyPct}% right ({plural(r.answers, 'answer')})</li>)}</ul>
                <p className="text-sm">{data.conf.sureButWrong === 0 ? 'You have not been wrong while sure.' : `${plural(data.conf.sureButWrong, 'answer')} wrong while you were sure. These are the most valuable ones to review.`}</p>
              </>
            )}
          </section>

          <section aria-label="Last 8 weeks" className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Last 8 weeks</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {data.trend.map((w) => (
                <li key={w.weekStart} className="flex items-center gap-2">
                  <span className="w-24 shrink-0">Week of {w.weekStart.slice(5)}</span>
                  <span aria-hidden className="h-3 rounded bg-accent" style={{ width: `${Math.round((w.answers / maxWeek) * 100)}px` }} />
                  <span>{w.answers === 0 ? 'no answers' : `${plural(w.answers, 'answer')}, ${w.accuracyPct}%`}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
