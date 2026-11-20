import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CountInput, ErrorBox, ListSkeleton } from '../components/bits'
import { Button, Card, EmptyState, LinkButton } from '../components/ui'
import { buildTopicTree, flattenTree } from '../content/tree'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { DEFAULT_MOCK, MOCK_MAX_QUESTIONS, MOCK_SECONDS_PER_QUESTION, buildMock, clampMockCount, scorePct, startRun, totalSeconds, type MockConfig } from '../mock/mock'
import { discardActive, saveActive, useMock } from '../mock/store'
import { newSeed } from '../practice/params'

const field = 'min-h-12 w-full rounded-xl border border-line bg-bg px-4 text-sm text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10'
const label = 'mb-1 block text-sm font-medium'
const minutes = (s: number) => Math.round(s / 60)

export default function MockSetup() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const cat = useCatalog()
  const mock = useMock(user?.id)
  const [cfg, setCfg] = useState<MockConfig>(DEFAULT_MOCK)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const qs = useQuestions(cfg.subjectId ? [cfg.subjectId] : null)

  const topicOptions = useMemo(
    () => (cat.status === 'ready' && cfg.subjectId ? flattenTree(buildTopicTree(cat.catalog.taxonomy.topics, cfg.subjectId)) : []),
    [cat, cfg.subjectId],
  )
  if (!user) return null
  if (cat.status === 'loading') return <ListSkeleton rows={5} />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  const { taxonomy, manifest } = cat.catalog

  const uid = user.id
  const available = qs.status === 'ready' ? buildMock(qs.questions, taxonomy.topics, { ...cfg, count: MOCK_MAX_QUESTIONS }, 'x').length : null
  const willUse = available === null ? null : Math.min(available, clampMockCount(cfg.count))

  function start(e: FormEvent) {
    e.preventDefault()
    if (qs.status !== 'ready' || !cat.status || cat.status !== 'ready') return
    const seed = newSeed()
    const questions = buildMock(qs.questions, taxonomy.topics, cfg, seed)
    if (questions.length === 0) return setError('No questions match these settings.')
    const r = saveActive(uid, startRun(questions, cfg, seed, crypto.randomUUID(), new Date(), manifest.contentVersion))
    if (!r.ok) return setError(r.error ?? 'Could not start the exam.')
    navigate('/app/mock/run')
  }

  const active = mock.active
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Timed assessment</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mock exam</h1></div>

      {active ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">You have an exam in progress</h2>
          <p className="text-muted">{active.questionIds.length} questions, {Object.keys(active.answers).length} answered. The clock keeps running while you are away.</p>
          <div className="flex flex-wrap gap-3">
            <LinkButton to="/app/mock/run">Resume exam</LinkButton>
            {confirmDiscard ? (
              <>
                <Button variant="secondary" onClick={() => { discardActive(uid); setConfirmDiscard(false) }}>Yes, discard it (nothing is recorded)</Button>
                <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard this exam</Button>
            )}
          </div>
        </Card>
      ) : manifest.totalQuestions === 0 ? (
        <EmptyState title="No questions available yet" body="There are no published questions to build an exam from." />
      ) : (
        <form onSubmit={start} className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6" aria-label="Mock exam setup">
          <p className="text-muted">A mock exam gives no feedback until the end. You can change answers and flag questions for review. Unanswered questions count as wrong.</p>
          <div>
            <label htmlFor="m-subject" className={label}>Subject</label>
            <select id="m-subject" className={field} value={cfg.subjectId ?? ''} onChange={(e) => setCfg((c) => ({ ...c, subjectId: e.target.value || null, topicId: null }))}>
              <option value="">All subjects</option>
              {taxonomy.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="m-topic" className={label}>Topic</label>
            <select id="m-topic" className={field} value={cfg.topicId ?? ''} disabled={!cfg.subjectId} onChange={(e) => setCfg((c) => ({ ...c, topicId: e.target.value || null }))}>
              <option value="">{cfg.subjectId ? 'All topics' : 'Choose a subject first'}</option>
              {topicOptions.map((n) => <option key={n.topic.id} value={n.topic.id}>{'  '.repeat(n.depth)}{n.topic.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="m-style" className={label}>Exam style</label>
              <select id="m-style" className={field} value={cfg.examStyle ?? ''} onChange={(e) => setCfg((c) => ({ ...c, examStyle: e.target.value || null }))}>
                <option value="">Any style</option>
                {taxonomy.examStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="m-count" className={label}>Number of questions (max {MOCK_MAX_QUESTIONS})</label>
              <CountInput id="m-count" max={MOCK_MAX_QUESTIONS} className={field} value={cfg.count} onValue={(n) => setCfg((c) => ({ ...c, count: clampMockCount(n) }))} />
            </div>
            <div>
              <label htmlFor="m-pace" className={label}>Time per question</label>
              <select id="m-pace" className={field} value={cfg.secondsPerQuestion} onChange={(e) => setCfg((c) => ({ ...c, secondsPerQuestion: Number(e.target.value) }))}>
                {MOCK_SECONDS_PER_QUESTION.map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
            </div>
          </div>
          {willUse === null ? <p className="text-muted">Counting questions…</p>
            : willUse === 0 ? <p role="status" className="text-danger">No questions match these settings.</p>
            : <p role="status" className="text-muted">{willUse} {willUse === 1 ? 'question' : 'questions'}, {minutes(totalSeconds(cfg, willUse))} minutes in total.{available !== null && available < cfg.count ? ` Only ${available} match, so the exam is shorter than you asked for.` : ''}</p>}
          {error ? <p role="alert" className="text-danger">{error}</p> : null}
          <div><Button type="submit" disabled={!willUse}>Start exam</Button></div>
        </form>
      )}

      <section aria-label="Past exams" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Past exams on this device</h2>
        {mock.results.length === 0 ? (
          <p className="text-muted">No finished exams yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mock.results.slice(0, 10).map((r) => (
              <li key={r.id}>
                <Link to={`/app/mock/result/${r.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2">
                  <span>{new Date(r.finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {r.total} questions{r.timedOut ? ' · time ran out' : ''}</span>
                  <strong>{r.correct}/{r.total} ({Math.round(scorePct(r))}%)</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
