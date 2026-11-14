import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { EMPTY_FILTER, isDefaultFilter, parseFilter, type BankFilter } from '../bank/filter'
import { useSavedFilterRepo, type SavedFilter } from '../bank/saved'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { useSessionRepo, type WExam } from '../session/repo'
import { chooseForConfig, candidatesFor, describeConfig } from '../session/start'
import { DEFAULT_CONFIG, MAX_SESSION_QUESTIONS, MAX_TIME_MINUTES, type SessionConfig, type SessionKind } from '../session/types'
import { useTagRepo, type WTag } from '../tags/repo'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural, type WTopic } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const input = 'min-h-12 w-full rounded-xl border border-line bg-bg px-4 text-sm text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10'
const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'
const KEEP = 'shuvromed-bank-view'
const newSeed = () => Math.floor(Math.random() * 2147483647)

function keptFilter(): BankFilter {
  try { return parseFilter((JSON.parse(sessionStorage.getItem(KEEP) ?? 'null') as { filter?: unknown } | null)?.filter) } catch { return { ...EMPTY_FILTER } }
}

/** Set up a practice run or a timed exam from your own questions, and start saved exams again. Hidden behind the workspace switch. */
export default function WorkspacePractice() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const savedRepo = useSavedFilterRepo()
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const navigate = useNavigate()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [topics, setTopics] = useState<WTopic[]>([])
  const [tags, setTags] = useState<WTag[]>([])
  const [saved, setSaved] = useState<SavedFilter[]>([])
  const [exams, setExams] = useState<WExam[]>([])
  const [source, setSource] = useState<string>('all')
  const [mode, setMode] = useState<SessionKind>('practice')
  const [count, setCount] = useState('20')
  const [shuffleQ, setShuffleQ] = useState(true)
  const [shuffleO, setShuffleO] = useState(false)
  const [feedback, setFeedback] = useState<'immediate' | 'end'>('immediate')
  const [minutes, setMinutes] = useState('')
  const [negative, setNegative] = useState(true)
  const [examName, setExamName] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const kept = useMemo(keptFilter, [])

  const load = useCallback(async () => {
    const [w, q, tg, sv, ex] = await Promise.all([ws.load(), qr.list(), tagRepo.list(), savedRepo.list(), sessions.listExams()])
    if (w.error || !w.data || q.error || !q.data || tg.error || !tg.data) { setStatus('error'); return }
    setTopics(w.data.topics); setQuestions(q.data); setTags(tg.data); setSaved(sv.data ?? []); setExams(ex.data ?? [])
    setStatus('ready')
  }, [ws, qr, tagRepo, savedRepo, sessions])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  const { filter, label } = useMemo((): { filter: BankFilter; label: string } => {
    if (source === 'bank') return { filter: kept, label: 'Filters from My questions' }
    const s = saved.find((x) => `saved:${x.id}` === source)
    if (s) return { filter: s.filter, label: s.name }
    return { filter: EMPTY_FILTER, label: 'All my questions' }
  }, [source, kept, saved])
  const ctx = useMemo(() => ({ topics, tags }), [topics, tags])
  const { eligible, waiting } = useMemo(() => candidatesFor(filter, questions, ctx), [filter, questions, ctx])

  if (!enabled) return <Navigate to="/app/settings" replace />

  const wanted = Math.floor(Number(count))
  const limit = minutes.trim() === '' ? null : Math.floor(Number(minutes))
  const problem =
    eligible.length === 0 ? 'No questions are available from this source.'
    : !Number.isFinite(wanted) || wanted < 1 ? 'Enter how many questions you want.'
    : wanted > MAX_SESSION_QUESTIONS ? `A session can have at most ${MAX_SESSION_QUESTIONS} questions.`
    : mode === 'exam' && limit !== null && (!Number.isFinite(limit) || limit < 1 || limit > MAX_TIME_MINUTES) ? `Time must be between 1 and ${MAX_TIME_MINUTES} minutes, or empty for no limit.`
    : null

  const configNow = (): SessionConfig => ({
    ...DEFAULT_CONFIG, mode, count: Math.min(Math.max(1, wanted || 1), MAX_SESSION_QUESTIONS), shuffleQuestions: shuffleQ, shuffleOptions: shuffleO,
    feedback: mode === 'exam' ? 'end' : feedback, timeLimitMinutes: mode === 'exam' ? limit : null, negativeMarking: negative, filter, sourceLabel: label, seed: newSeed(),
  })

  async function begin(config: SessionConfig, examId: string | null, titleBase: string) {
    setError(null)
    const { picked } = chooseForConfig(config, questions, ctx)
    if (!picked.length) return setError('No questions are available from this source.')
    const r = await sessions.start({ config, questions: picked, title: titleBase, examId })
    if (r.error || !r.data) return setError(r.error ?? 'Could not start.')
    navigate(`/app/workspace/session/${r.data.id}`)
  }
  async function saveExam() {
    setError(null)
    const r = await sessions.createExam(examName ?? '', { ...configNow(), mode: 'exam', feedback: 'end', timeLimitMinutes: limit })
    if (r.error) return setError(r.error)
    setNotice(`Saved exam "${r.data?.name}". Start it again any time from the list below.`)
    setExamName(null)
    await load()
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Question sessions</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Practice and exams</h1></div>
        <Link className="underline" to="/app/workspace/revision">Revision</Link>
        <Link className="underline" to="/app/workspace/sessions">Past sessions</Link>
        <Link className="underline" to="/app/workspace/questions">My questions</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your questions.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}
      <div role="status" aria-live="polite">{notice ? <p className="text-muted">{notice}</p> : null}</div>

      {status === 'ready' && questions.length === 0 ? (
        <EmptyState title="No questions yet" body="Add questions on My questions or import them first, then come back to practise." />
      ) : null}

      {status === 'ready' && questions.length > 0 ? (
        <section aria-label="New session" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
          <div><h2 className="text-base font-semibold tracking-tight">Start a session</h2><p className="mt-1 text-sm text-muted">Choose your source, set the conditions, then begin.</p></div>
          <label className="flex flex-col gap-1 text-sm font-medium">Questions from
            <select className={input} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">All my questions</option>
              {!isDefaultFilter(kept) ? <option value="bank">The filters last used on My questions</option> : null}
              {saved.map((s) => <option key={s.id} value={`saved:${s.id}`}>Saved filter: {s.name}</option>)}
            </select>
          </label>
          <p className="text-sm text-muted" aria-live="polite">{plural(eligible.length, 'question')} available{waiting ? `; ${plural(waiting, 'question')} left out until an edit finishes syncing` : ''}.</p>

          <fieldset className="flex flex-col gap-2 rounded-xl bg-bg p-3">
            <legend className="text-sm font-medium">Type of session</legend>
            <label className="flex min-h-12 items-center gap-3 rounded-lg px-2 text-sm transition-colors hover:bg-surface"><input type="radio" name="mode" className="size-5" checked={mode === 'practice'} onChange={() => setMode('practice')} /> Practice (see the answer after each question)</label>
            <label className="flex min-h-11 items-center gap-3"><input type="radio" name="mode" className="size-5" checked={mode === 'exam'} onChange={() => setMode('exam')} /> Exam (results only at the end, optional timer)</label>
          </fieldset>

          <label className="flex flex-col gap-1 text-sm font-medium">Number of questions
            <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))} />
          </label>
          {mode === 'exam' ? (
            <label className="flex flex-col gap-1 text-sm font-medium">Time limit in minutes (leave empty for no limit)
              <input className={input} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} />
            </label>
          ) : (
            <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm transition-colors hover:bg-surface"><input type="checkbox" className="size-5" checked={feedback === 'immediate'} onChange={(e) => setFeedback(e.target.checked ? 'immediate' : 'end')} /> Show the answer after each question</label>
          )}
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} /> Shuffle the questions</label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} /> Shuffle the options</label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> Apply negative marking (marks lost are set on each question)</label>

          {problem ? <p className="text-sm text-muted">{problem}</p> : null}
          {error ? <p role="alert" className="text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!problem} onClick={() => void begin(configNow(), null, `${mode === 'exam' ? 'Exam' : 'Practice'}: ${label}`)}>{mode === 'exam' ? 'Start exam' : 'Start practice'}</Button>
            {mode === 'exam' && examName === null ? <Button variant="secondary" disabled={!!problem} onClick={() => setExamName('')}>Save as a repeatable exam</Button> : null}
          </div>
          {examName !== null ? (
            <form className="flex flex-col gap-2" aria-label="Save exam" onSubmit={(e) => { e.preventDefault(); void saveExam() }}>
              <label className="flex flex-col gap-1 text-sm font-medium">Name for this exam
                <input className={input} value={examName} maxLength={80} onChange={(e) => setExamName(e.target.value)} />
              </label>
              <div className="flex gap-2"><Button type="submit">Save exam</Button><Button type="button" variant="secondary" onClick={() => setExamName(null)}>Cancel</Button></div>
            </form>
          ) : null}
        </section>
      ) : null}

      {status === 'ready' ? (
        <section aria-label="Saved exams" className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">Saved exams</h2>
          {exams.length === 0 ? <p className="text-sm text-muted">None yet. Set up an exam above and press Save as a repeatable exam.</p> : (
            <ul className="flex flex-col gap-2">
              {exams.map((e) => (
                <li key={e.id}>
                  <Card className="border-line/90 transition-colors hover:border-brand/30">
                    <p className={e.archived ? 'text-muted' : 'font-semibold tracking-tight'}>{e.name}{e.archived ? ' (archived)' : ''}</p>
                    <p className="text-sm text-muted">{describeConfig(e.config)}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!e.archived ? <Button aria-label={`Start exam: ${e.name}`} onClick={() => void begin({ ...e.config, seed: newSeed() }, e.id, e.name)}>Start</Button> : null}
                      <button type="button" className={small} aria-label={`${e.archived ? 'Restore' : 'Archive'} exam: ${e.name}`} onClick={() => void sessions.setExamArchived(e.id, !e.archived).then(load)}>{e.archived ? 'Restore' : 'Archive'}</button>
                      <button type="button" className={small} aria-label={`Delete exam: ${e.name}`} onClick={() => setDeleting(e.id)}>Delete</button>
                    </div>
                    {deleting === e.id ? (
                      <div role="group" aria-label={`Confirm delete ${e.name}`} className="mt-2 rounded-xl border border-line bg-surface2 p-3">
                        <p className="text-sm">Delete this saved exam? Sessions you already ran from it are kept.</p>
                        <div className="mt-2 flex gap-2"><Button onClick={() => void sessions.removeExam(e.id).then(() => { setDeleting(null); return load() })}>Delete exam</Button><Button variant="secondary" onClick={() => setDeleting(null)}>Keep it</Button></div>
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
