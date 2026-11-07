import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Badge, ErrorBox, ListSkeleton, pctText } from '../components/bits'
import { Button, Card, EmptyState, LinkButton } from '../components/ui'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { scorePct, summarizeResult } from '../mock/mock'
import { useMock } from '../mock/store'
import { presentQuestion } from '../practice/shuffle'
import { formatClock } from './PracticePlayer'

export default function MockResultPage() {
  const { resultId } = useParams()
  const { user } = useAuth()
  const mock = useMock(user?.id)
  const cat = useCatalog()
  const qs = useQuestions(null)
  const [view, setView] = useState<'all' | 'missed' | 'flagged'>('all')
  const result = mock.results.find((r) => r.id === resultId)

  if (!result) return <EmptyState title="Result not found" body="This exam result is not on this device." action={<LinkButton to="/app/mock">Back to mock exams</LinkButton>} />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || qs.status !== 'ready') return <ListSkeleton rows={3} />

  const topics = cat.catalog.taxonomy.topics
  const topicName = (id: string) => topics.find((t) => t.id === id)?.name ?? id
  const byId = new Map(qs.questions.map((q) => [q.id, q]))
  const s = summarizeResult(result, qs.questions)
  const took = Date.parse(result.finishedAt) - Date.parse(result.startedAt)
  const rows = result.questionIds.flatMap((id, i) => {
    const q = byId.get(id)
    if (!q) return []
    const sel = result.answers[id]
    return [{ q, i, sel, right: sel === q.correctOptionId, flagged: result.flagged.includes(id) }]
  })
  const shown = rows.filter((r) => (view === 'missed' ? !r.right : view === 'flagged' ? r.flagged : true))

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Exam result</h1>
      {result.timedOut ? <p role="status" className="text-muted">Time ran out. Unanswered questions count as wrong.</p> : null}
      <Card>
        <p className="text-sm text-muted">Score (unanswered questions count as wrong)</p>
        <p className="text-4xl font-extrabold" data-testid="mock-score">{result.correct} / {result.total}</p>
        <p className="mt-1 text-muted">
          {Math.round(scorePct(result))}% · {result.answered} answered · {s.incorrect} wrong · {s.skipped} unanswered · Accuracy on answered {pctText(s.accuracyPct)} · Time used {formatClock(took)} of {formatClock(result.total * result.config.secondsPerQuestion * 1000)}
        </p>
      </Card>
      {Object.keys(s.byTopic).length > 0 ? (
        <Card>
          <h2 className="mb-2 font-semibold">By topic</h2>
          <ul className="flex flex-col gap-1">
            {Object.entries(s.byTopic).map(([id, g]) => (
              <li key={id} className="flex justify-between gap-3"><span>{topicName(id)}</span><span className="text-muted">{g.correct}/{g.answered} ({pctText(g.accuracyPct)})</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section aria-label="Question review" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Review your answers</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {([['all', 'All'], ['missed', 'Wrong or unanswered'], ['flagged', 'Flagged']] as const).map(([v, text]) => (
            <Button key={v} variant={view === v ? 'primary' : 'secondary'} aria-pressed={view === v} onClick={() => setView(v)}>{text}</Button>
          ))}
        </div>
        {shown.length === 0 ? <p className="text-muted">Nothing to show here.</p> : (
          <ul aria-label="Reviewed questions" className="flex flex-col gap-3">
            {shown.map(({ q, i, sel, right, flagged }) => {
              const p = presentQuestion(q, { shuffleOptions: true, seed: result.seed })
              const yours = p.options.find((o) => o.id === sel)
              return (
                <li key={q.id}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={right ? 'good' : 'bad'}>{right ? 'Correct' : sel ? 'Wrong' : 'Not answered'}</Badge>
                      {flagged ? <Badge>Flagged</Badge> : null}
                      {q.isDemo ? <Badge tone="demo">DEMO</Badge> : null}
                      <Badge>{topicName(q.topicId)}</Badge>
                    </div>
                    <p className="whitespace-pre-line"><strong>{i + 1}.</strong> {q.stem}</p>
                    <p>Your answer: {yours ? `${yours.label}. ${yours.text}` : 'none'}</p>
                    <p>Correct answer: {p.correctLabel}. {p.options.find((o) => o.label === p.correctLabel)?.text}</p>
                    <details>
                      <summary className="min-h-12 cursor-pointer py-3 font-medium">Explanation</summary>
                      <p className="whitespace-pre-line">{q.explanation}</p>
                      <ul className="mt-2 flex flex-col gap-1">{p.options.map((o) => <li key={o.label}><strong>{o.label}.</strong> {q.optionAnalysis[o.id]}</li>)}</ul>
                      {q.references.length === 0 ? <p className="mt-2 text-sm text-muted">No references are attached to this question.</p> : null}
                    </details>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap gap-3">
        <LinkButton to="/app/mock">Another exam</LinkButton>
        <LinkButton to="/app/progress" variant="secondary">See my progress</LinkButton>
      </div>
    </div>
  )
}
