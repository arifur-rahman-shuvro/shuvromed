import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Badge, ErrorBox, ListSkeleton, pctText } from '../components/bits'
import { Button, Card, EmptyState, LinkButton } from '../components/ui'
import type { Taxonomy } from '../content/bundle'
import type { OptionId, Question } from '../content/schema'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { addAttempt, loadAttempts, newAttemptId } from '../practice/attempts'
import { configToParams, newSeed, paramsToConfig } from '../practice/params'
import { isCorrect, summarize, timeLimitMs, type SessionAnswer } from '../practice/scoring'
import { selectQuestions, type PracticeConfig } from '../practice/session'
import { presentQuestion } from '../practice/shuffle'
import { practiceContext } from '../practice/context'
import { loadUserData } from '../userdata/store'
import StudyTools from '../components/StudyTools'

interface Answer {
  selected: OptionId
  correct: boolean
  timeMs: number
}

const CONFIDENCE: [number, string][] = [[1, 'Guess'], [2, 'Unsure'], [3, 'Maybe'], [4, 'Fairly sure'], [5, 'Certain']]

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function PracticePlayer() {
  const [params] = useSearchParams()
  const cfg = useMemo(() => paramsToConfig(params), [params])
  const seed = params.get('seed') ?? 'default'
  const key = params.toString()
  const cat = useCatalog()
  const qs = useQuestions(cfg.subjectId ? [cfg.subjectId] : null)
  const { user } = useAuth()
  const [session, setSession] = useState<{ key: string; questions: Question[] } | null>(null)

  // The question list is fixed when the session starts, so answering never reshuffles or shrinks it.
  useEffect(() => {
    if (session?.key === key) return
    if (cat.status === 'ready' && qs.status === 'ready') {
      const history = user?.id ? loadAttempts(user.id) : []
      const ctx = user?.id ? practiceContext(history, loadUserData(user.id)) : {}
      setSession({ key, questions: selectQuestions(qs.questions, cat.catalog.taxonomy.topics, cfg, history, seed, ctx) })
    }
  }, [session, key, cat, qs, cfg, seed, user?.id])

  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || session?.key !== key) return <ListSkeleton rows={3} />

  if (session.questions.length === 0) {
    return (
      <EmptyState
        title="No questions match"
        body="There are no questions for these settings. Try a different topic, difficulty or mode."
        action={<LinkButton to={`/app/practice?${configToParams(cfg).toString()}`}>Change settings</LinkButton>}
      />
    )
  }
  return (
    <SessionView
      key={key}
      questions={session.questions}
      cfg={cfg}
      seed={seed}
      taxonomy={cat.catalog.taxonomy}
      contentVersion={cat.catalog.manifest.contentVersion}
      userId={user?.id}
    />
  )
}

function SessionView({
  questions, cfg, seed, taxonomy, contentVersion, userId,
}: {
  questions: Question[]
  cfg: PracticeConfig
  seed: string
  taxonomy: Taxonomy
  contentVersion: string
  userId: string | undefined
}) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [selected, setSelected] = useState<OptionId | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [startedAt] = useState(() => Date.now())
  const shownAt = useRef(0) // set when a question is shown; only read inside the submit handler
  const [now, setNow] = useState(() => Date.now())

  const limit = cfg.timed ? timeLimitMs(questions.length) : null
  const remaining = limit === null ? null : Math.max(0, limit - (now - startedAt))

  useEffect(() => {
    if (finished) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [finished])

  useEffect(() => {
    if (remaining === 0 && !finished) setFinished(true)
  }, [remaining, finished])

  useEffect(() => {
    shownAt.current = Date.now()
    setSelected(null)
    setConfidence(null)
  }, [index])

  const question = questions[index]
  const presented = useMemo(() => presentQuestion(question, { shuffleOptions: cfg.shuffleOptions, seed }), [question, cfg.shuffleOptions, seed])
  const answer = answers[question.id]
  const answeredCount = Object.keys(answers).length
  const topicName = (id: string) => taxonomy.topics.find((t) => t.id === id)?.name ?? id

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected || answer) return
    const correct = isCorrect(question, selected)
    const timeMs = Math.min(3_600_000, Math.max(0, Date.now() - shownAt.current))
    setAnswers((a) => ({ ...a, [question.id]: { selected, correct, timeMs } }))
    if (userId) {
      const r = addAttempt(userId, {
        id: newAttemptId(),
        questionId: question.id,
        selectedOptionId: selected,
        isCorrect: correct,
        timeMs,
        mode: cfg.mode === 'due' ? 'revision' : 'practice',
        ...(confidence ? { confidence } : {}),
        attemptedAt: new Date().toISOString(),
        contentVersion,
      })
      setSaveError(r.ok ? null : (r.error ?? 'Progress could not be saved.'))
    }
  }

  function requestFinish() {
    if (answeredCount === questions.length) setFinished(true)
    else setConfirmEnd(true)
  }

  function again() {
    navigate(`/app/practice/play?${configToParams(cfg, newSeed()).toString()}`)
  }

  if (finished) {
    const list: SessionAnswer[] = questions.flatMap((q) => {
      const a = answers[q.id]
      return a ? [{ questionId: q.id, topicId: q.topicId, subjectId: q.subjectId, difficulty: q.difficulty, selectedOptionId: a.selected, isCorrect: a.correct, timeMs: a.timeMs }] : []
    })
    const s = summarize(list, questions.length)
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-bold">Session complete</h1>
        {remaining === 0 ? <p role="status" className="text-muted">Time ran out. Unanswered questions count as skipped.</p> : null}
        <Card>
          <p className="text-sm text-muted">Score (skipped questions count as not correct)</p>
          <p className="text-4xl font-extrabold" data-testid="score">{s.correct} / {s.total}</p>
          <p className="mt-1 text-muted">
            {pctText(s.scorePct)} overall · Accuracy on answered {pctText(s.accuracyPct)} · {s.incorrect} incorrect · {s.skipped} skipped
            {s.avgTimeMs !== null ? ` · average ${formatClock(s.avgTimeMs)} per answer` : ''}
          </p>
        </Card>
        {Object.keys(s.byTopic).length > 0 ? (
          <Card>
            <h2 className="mb-2 font-semibold">By topic</h2>
            <ul className="flex flex-col gap-1">
              {Object.entries(s.byTopic).map(([id, g]) => (
                <li key={id} className="flex justify-between gap-3">
                  <span>{topicName(id)}</span>
                  <span className="text-muted">{g.correct}/{g.answered} ({pctText(g.accuracyPct)})</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <p className="text-sm text-muted">Your answers are saved on this device and sync to your account when you are online.</p>
        {saveError ? <p role="alert" className="text-danger">{saveError}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button onClick={again}>Practise again</Button>
          <LinkButton to="/app/subjects" variant="secondary">Back to subjects</LinkButton>
        </div>
      </div>
    )
  }

  const isLast = index === questions.length - 1
  const pct = Math.round((answeredCount / questions.length) * 100)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold" data-testid="progress-text">Question {index + 1} of {questions.length}</p>
        <p className="text-sm text-muted" aria-label={remaining !== null ? 'Time remaining' : 'Time elapsed'}>
          {remaining !== null ? `${formatClock(remaining)} left` : `${formatClock(now - startedAt)} elapsed`}
        </p>
      </div>
      <div role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-surface2">
        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          {question.isDemo ? <Badge tone="demo">DEMO · unreviewed sample</Badge> : null}
          <Badge>{topicName(question.topicId)}</Badge>
          <Badge>{question.difficulty}</Badge>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={Boolean(answer)}>
            <legend className="mb-3 whitespace-pre-line text-lg font-medium">{question.stem}</legend>
            {presented.options.map((o) => {
              const chosen = (answer ? answer.selected : selected) === o.id
              const isRight = answer && o.id === question.correctOptionId
              const isWrongPick = answer && chosen && !isRight
              return (
                <label
                  key={o.label}
                  className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    isRight ? 'border-success' : isWrongPick ? 'border-danger' : chosen ? 'border-brand' : 'border-line'
                  }`}
                >
                  <input type="radio" name="answer" value={o.id} checked={chosen} onChange={() => setSelected(o.id)} className="mt-1 size-5" />
                  <span>
                    <strong>{o.label}.</strong> {o.text}
                    {isRight ? <span className="ml-2 font-semibold text-success">✓ Correct answer</span> : null}
                    {isWrongPick ? <span className="ml-2 font-semibold text-danger">✗ Your answer</span> : null}
                  </span>
                </label>
              )
            })}
          </fieldset>
          {!answer ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">How sure are you? (optional)</legend>
              <div className="flex flex-wrap gap-2">
                {CONFIDENCE.map(([v, text]) => (
                  <label key={v} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${confidence === v ? 'border-brand' : 'border-line'}`}>
                    <input type="radio" name="confidence" value={v} checked={confidence === v} onChange={() => setConfidence(v)} className="size-4" />
                    {text}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {!answer ? <Button type="submit" disabled={!selected}>Submit answer</Button> : null}
        </form>
      </Card>

      {userId ? <StudyTools key={question.id} userId={userId} questionId={question.id} /> : null}

      {answer ? (
        <section aria-label="Answer explanation" className="flex flex-col gap-3">
          <p role="status" className={`text-lg font-bold ${answer.correct ? 'text-success' : 'text-danger'}`}>
            {answer.correct ? 'Correct' : `Incorrect. The correct answer is ${presented.correctLabel}.`}
          </p>
          <Card>
            <h2 className="mb-1 font-semibold">Explanation</h2>
            <p className="whitespace-pre-line">{question.explanation}</p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Why each option is right or wrong</h2>
            <ul className="flex flex-col gap-2">
              {presented.options.map((o) => (
                <li key={o.label}><strong>{o.label}.</strong> {question.optionAnalysis[o.id]}</li>
              ))}
            </ul>
          </Card>
          {question.clinicalPearl ? (
            <Card>
              <h2 className="mb-1 font-semibold">Clinical pearl</h2>
              <p>{question.clinicalPearl}</p>
            </Card>
          ) : null}
          {question.learningObjectives.length > 0 ? (
            <Card>
              <h2 className="mb-1 font-semibold">Learning points</h2>
              <ul className="list-disc pl-5">{question.learningObjectives.map((l) => <li key={l}>{l}</li>)}</ul>
            </Card>
          ) : null}
          {question.references.length > 0 ? (
            <Card>
              <h2 className="mb-1 font-semibold">References</h2>
              <ul className="list-disc pl-5">
                {question.references.map((r) => (
                  <li key={r.title}>
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">{r.title}</a> : r.title}
                    {r.edition ? `, ${r.edition} edition` : ''}{r.year ? ` (${r.year})` : ''}{r.pages ? `, ${r.pages}` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <p className="text-sm text-muted">No references are attached to this question.</p>
          )}
        </section>
      ) : null}

      {saveError ? <p role="alert" className="text-danger">{saveError}</p> : null}

      {confirmEnd ? (
        <div role="alertdialog" aria-labelledby="end-title" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <p id="end-title" className="font-semibold">End this session?</p>
          <p className="text-muted">{questions.length - answeredCount} unanswered {questions.length - answeredCount === 1 ? 'question' : 'questions'} will count as skipped.</p>
          <div className="flex gap-3">
            <Button onClick={() => setFinished(true)}>End session</Button>
            <Button variant="secondary" onClick={() => setConfirmEnd(false)}>Keep practising</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</Button>
          {!isLast ? <Button variant={answer ? 'primary' : 'secondary'} onClick={() => setIndex(index + 1)}>{answer ? 'Next question' : 'Skip'}</Button> : null}
          <Button variant={isLast && answer ? 'primary' : 'ghost'} onClick={requestFinish}>Finish session</Button>
        </div>
      )}
    </div>
  )
}
