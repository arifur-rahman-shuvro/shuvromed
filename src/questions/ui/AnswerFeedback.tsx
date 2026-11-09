import { Button } from '../../components/ui'
import type { GradeResult } from '../grade'
import type { ViewQuestion } from './AnswerArea'

const OUTCOME_TEXT = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', unanswered: 'No answer given' } as const
const OUTCOME_STYLE = { correct: 'text-success', partial: 'text-accent', incorrect: 'text-danger', unanswered: 'text-muted' } as const

/** The verdict after an answer is checked: outcome, marks, what was missed, the explanation and the reference. */
export default function AnswerFeedback({ question: q, result, onRetry, negativeOff = false }: { question: ViewQuestion; result: GradeResult; onRetry?: () => void; negativeOff?: boolean }) {
  const score = negativeOff ? Math.max(0, result.score) : result.score
  return (
    <section aria-label="Answer feedback" className="flex flex-col gap-2 rounded-xl border border-line p-3">
      <p role="status" className={`font-semibold ${OUTCOME_STYLE[result.outcome]}`}>
        {OUTCOME_TEXT[result.outcome]}{result.outcome === 'partial' || score < 0 ? ` (${score} of 1 mark)` : ''}
      </p>
      {result.detail.type === 'FILL_GAP'
        ? <ul className="list-disc pl-5 text-sm">{result.detail.blanks.map((b, i) => <li key={b.id}>Blank {i + 1}: {b.ok ? 'correct' : `accepted answers are ${b.accepted.join(' or ')}`}</li>)}</ul>
        : null}
      {result.detail.type === 'MULTIPLE_MCQ' && result.detail.missed > 0 ? <p className="text-sm">You missed {result.detail.missed} correct {result.detail.missed === 1 ? 'option' : 'options'}.</p> : null}
      {q.explanation ? <p className="whitespace-pre-wrap text-sm"><span className="font-medium">Explanation: </span>{q.explanation}</p> : null}
      {q.reference ? <p className="text-sm text-muted"><span className="font-medium">Reference: </span>{q.reference}</p> : null}
      {onRetry ? <div><Button variant="secondary" onClick={onRetry}>Try again</Button></div> : null}
    </section>
  )
}
