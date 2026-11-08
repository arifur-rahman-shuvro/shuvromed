import { useMemo, useState } from 'react'
import { Button } from '../../components/ui'
import { grade, type GradeResult } from '../grade'
import { shuffled } from '../registry'
import { blankMarkers, type MultipleContent, type QuestionContent, type QuestionType, type SbaContent, type TrueFalseContent } from '../schema'

export interface ViewQuestion {
  type: QuestionType
  stem: string
  content: QuestionContent
  explanation?: string | null
  reference?: string | null
}
export type Response = { selected?: string | string[]; value?: boolean; answers?: Record<string, string> }

const SPLIT = /(\{\{[A-Za-z0-9_-]{1,40}\}\})/

const OUTCOME_TEXT = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', unanswered: 'No answer given' } as const
const OUTCOME_STYLE = { correct: 'text-success', partial: 'text-accent', incorrect: 'text-danger', unanswered: 'text-muted' } as const

/**
 * One question the way a learner sees it: answer, check, feedback. Used by the editor's preview now and by
 * practice and exams later. `seed` fixes the option order, so a question looks the same when reviewed.
 */
export default function QuestionView({ question, seed, onGraded, shuffleOptions = false }: { question: ViewQuestion; seed?: number; onGraded?: (r: GradeResult, response: Response) => void; shuffleOptions?: boolean }) {
  const [resp, setResp] = useState<Response>({})
  const [result, setResult] = useState<GradeResult | null>(null)
  const done = result !== null
  const q = question

  const options = useMemo(() => {
    if (q.type !== 'SBA' && q.type !== 'MULTIPLE_MCQ') return []
    const list = (q.content as SbaContent | MultipleContent).options
    return shuffleOptions ? shuffled(list, seed ?? 1) : list
  }, [q.type, q.content, seed, shuffleOptions])

  function check() {
    const r = grade({ question_type: q.type, stem: q.stem, content: q.content }, resp)
    setResult(r)
    onGraded?.(r, resp)
  }
  function again() { setResp({}); setResult(null) }

  const correctSet = new Set<string>(
    q.type === 'SBA' ? [(q.content as SbaContent).correct_option_id] : q.type === 'MULTIPLE_MCQ' ? (q.content as MultipleContent).correct_option_ids : [],
  )
  const chosen = new Set<string>(Array.isArray(resp.selected) ? resp.selected : typeof resp.selected === 'string' ? [resp.selected] : [])
  const hint = (id: string) => (!done ? '' : correctSet.has(id) ? ' (correct answer)' : chosen.has(id) ? ' (your answer, not correct)' : '')

  return (
    <div className="flex flex-col gap-4">
      {q.type === 'FILL_GAP' ? (
        <div>
          <p className="text-sm font-medium text-muted">Type the missing {blankMarkers(q.stem).length === 1 ? 'word' : 'words'}</p>
          <p className="mt-1 whitespace-pre-wrap text-lg leading-9">
            {q.stem.split(SPLIT).map((part, i) => {
              const m = /^\{\{(.+)\}\}$/.exec(part)
              if (!m) return <span key={i}>{part}</span>
              const id = m[1]
              const det = result?.detail.type === 'FILL_GAP' ? result.detail.blanks.find((b) => b.id === id) : undefined
              return (
                <input
                  key={i}
                  className={`mx-1 min-h-11 w-40 max-w-full rounded-lg border bg-surface px-2 align-middle text-base ${det ? (det.ok ? 'border-success' : 'border-danger') : 'border-line'}`}
                  aria-label={`Answer for blank ${blankMarkers(q.stem).indexOf(id) + 1}`}
                  value={resp.answers?.[id] ?? ''}
                  disabled={done}
                  autoComplete="off"
                  onChange={(e) => setResp({ ...resp, answers: { ...resp.answers, [id]: e.target.value } })}
                />
              )
            })}
          </p>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="whitespace-pre-wrap text-lg font-medium">{q.stem}</legend>
          {q.type === 'MULTIPLE_MCQ' ? <p className="text-sm text-muted">Choose all that apply.</p> : null}
          {q.type === 'TRUE_FALSE'
            ? ([true, false] as const).map((v) => (
                <label key={String(v)} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3">
                  <input type="radio" name="answer" className="size-5" checked={resp.value === v} disabled={done} onChange={() => setResp({ value: v })} />
                  <span>{v ? 'True' : 'False'}{done ? (v === (q.content as TrueFalseContent).correct_answer ? ' (correct answer)' : resp.value === v ? ' (your answer, not correct)' : '') : ''}</span>
                </label>
              ))
            : options.map((o) => (
                <div key={o.id} className="flex flex-col">
                  <label className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 ${done && correctSet.has(o.id) ? 'border-success' : done && chosen.has(o.id) ? 'border-danger' : 'border-line'}`}>
                    <input
                      type={q.type === 'SBA' ? 'radio' : 'checkbox'}
                      name="answer"
                      className="size-5"
                      checked={chosen.has(o.id)}
                      disabled={done}
                      onChange={(e) => {
                        if (q.type === 'SBA') setResp({ selected: o.id })
                        else setResp({ selected: e.target.checked ? [...chosen, o.id] : [...chosen].filter((x) => x !== o.id) })
                      }}
                    />
                    <span>{o.text}{hint(o.id)}</span>
                  </label>
                  {done && o.explanation ? <p className="px-3 pt-1 text-sm text-muted">{o.explanation}</p> : null}
                </div>
              ))}
        </fieldset>
      )}

      {!done ? (
        <div><Button onClick={check}>Check answer</Button></div>
      ) : (
        <section aria-label="Answer feedback" className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <p role="status" className={`font-semibold ${OUTCOME_STYLE[result.outcome]}`}>
            {OUTCOME_TEXT[result.outcome]}{result.outcome === 'partial' || result.score < 0 ? ` (${result.score} of 1 mark)` : ''}
          </p>
          {result.detail.type === 'FILL_GAP'
            ? <ul className="list-disc pl-5 text-sm">{result.detail.blanks.map((b, i) => <li key={b.id}>Blank {i + 1}: {b.ok ? 'correct' : `accepted answers are ${b.accepted.join(' or ')}`}</li>)}</ul>
            : null}
          {result.detail.type === 'MULTIPLE_MCQ' && result.detail.missed > 0 ? <p className="text-sm">You missed {result.detail.missed} correct {result.detail.missed === 1 ? 'option' : 'options'}.</p> : null}
          {q.explanation ? <p className="whitespace-pre-wrap text-sm"><span className="font-medium">Explanation: </span>{q.explanation}</p> : null}
          {q.reference ? <p className="text-sm text-muted"><span className="font-medium">Reference: </span>{q.reference}</p> : null}
          <div><Button variant="secondary" onClick={again}>Try again</Button></div>
        </section>
      )}
    </div>
  )
}
