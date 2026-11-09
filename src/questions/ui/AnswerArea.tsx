import { blankMarkers, type MultipleContent, type QuestionContent, type QuestionType, type SbaContent, type TrueFalseContent } from '../schema'
import type { GradeResult } from '../grade'

export interface ViewQuestion {
  type: QuestionType
  stem: string
  content: QuestionContent
  explanation?: string | null
  reference?: string | null
}
export type Response = { selected?: string | string[]; value?: boolean; answers?: Record<string, string> }
export type Option = { id: string; text: string; explanation?: string }

const SPLIT = /(\{\{[A-Za-z0-9_-]{1,40}\}\})/

/**
 * The answering part of a question: the stem with its choices or blanks. It is controlled (the caller keeps the response), so
 * the same piece serves practice, exams and the read-only review. `done` shows the right and wrong choices; `result` adds blank-by-blank marking.
 */
export default function AnswerArea({ question: q, options, response, onChange, done = false, result = null, locked = false }: {
  question: ViewQuestion
  /** The options in the order to show (only for the two option types). */
  options: Option[]
  response: Response
  onChange: (r: Response) => void
  done?: boolean
  result?: GradeResult | null
  /** Cannot be changed (but no right/wrong marking), for example when time has run out. */
  locked?: boolean
}) {
  const off = done || locked
  const correctSet = new Set<string>(
    q.type === 'SBA' ? [(q.content as SbaContent).correct_option_id] : q.type === 'MULTIPLE_MCQ' ? (q.content as MultipleContent).correct_option_ids : [],
  )
  const chosen = new Set<string>(Array.isArray(response.selected) ? response.selected : typeof response.selected === 'string' ? [response.selected] : [])
  const hint = (id: string) => (!done ? '' : correctSet.has(id) ? ' (correct answer)' : chosen.has(id) ? ' (your answer, not correct)' : '')

  if (q.type === 'FILL_GAP') {
    return (
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
                value={response.answers?.[id] ?? ''}
                disabled={off}
                autoComplete="off"
                onChange={(e) => onChange({ ...response, answers: { ...response.answers, [id]: e.target.value } })}
              />
            )
          })}
        </p>
      </div>
    )
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="whitespace-pre-wrap text-lg font-medium">{q.stem}</legend>
      {q.type === 'MULTIPLE_MCQ' ? <p className="text-sm text-muted">Choose all that apply.</p> : null}
      {q.type === 'TRUE_FALSE'
        ? ([true, false] as const).map((v) => (
            <label key={String(v)} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3">
              <input type="radio" name="answer" className="size-5" checked={response.value === v} disabled={off} onChange={() => onChange({ value: v })} />
              <span>{v ? 'True' : 'False'}{done ? (v === (q.content as TrueFalseContent).correct_answer ? ' (correct answer)' : response.value === v ? ' (your answer, not correct)' : '') : ''}</span>
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
                  disabled={off}
                  onChange={(e) => {
                    if (q.type === 'SBA') onChange({ selected: o.id })
                    else onChange({ selected: e.target.checked ? [...chosen, o.id] : [...chosen].filter((x) => x !== o.id) })
                  }}
                />
                <span>{o.text}{hint(o.id)}</span>
              </label>
              {done && o.explanation ? <p className="px-3 pt-1 text-sm text-muted">{o.explanation}</p> : null}
            </div>
          ))}
    </fieldset>
  )
}
