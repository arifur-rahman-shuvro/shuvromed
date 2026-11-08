import { blankMarkers, MAX_ANSWERS_PER_BLANK, MAX_BLANKS, MAX_OPTIONS, type FillGapContent, type MultipleContent, type QuestionContent, type QuestionType, type SbaContent, type TrueFalseContent } from '../schema'

const field = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'
const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'

export const nextId = (ids: string[], prefix: string): string => {
  let n = ids.length + 1
  while (ids.includes(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

interface Props { type: QuestionType; stem: string; content: QuestionContent; onStem: (s: string) => void; onContent: (c: QuestionContent) => void }

/** The type-specific part of the editor. The stem is passed in because a fill-in-the-gap stem carries the blank markers. */
export default function ContentEditor({ type, stem, content, onStem, onContent }: Props) {
  if (type === 'SBA' || type === 'MULTIPLE_MCQ') return <OptionsEditor multiple={type === 'MULTIPLE_MCQ'} content={content as SbaContent | MultipleContent} onContent={onContent} />
  if (type === 'TRUE_FALSE') return <TrueFalseEditor content={content as TrueFalseContent} onContent={onContent} />
  return <FillGapEditor stem={stem} content={content as FillGapContent} onStem={onStem} onContent={onContent} />
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number | undefined; min: number; max: number; step: number; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">{label}
      <input className={field} type="number" inputMode="decimal" min={min} max={max} step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  )
}

function withScoring<T extends { scoring?: Record<string, unknown> }>(c: T, patch: Record<string, unknown>): T {
  const scoring = { ...c.scoring, ...patch }
  for (const k of Object.keys(scoring)) if (scoring[k] === undefined) delete scoring[k]
  const next = { ...c, scoring }
  if (!Object.keys(scoring).length) delete (next as { scoring?: unknown }).scoring
  return next
}

function OptionsEditor({ multiple, content, onContent }: { multiple: boolean; content: SbaContent | MultipleContent; onContent: (c: QuestionContent) => void }) {
  const c = content as SbaContent & MultipleContent
  const correct = new Set<string>(multiple ? c.correct_option_ids ?? [] : c.correct_option_id ? [c.correct_option_id] : [])
  const setOptions = (options: typeof c.options, fix?: Partial<typeof c>) => onContent({ ...c, options, ...fix } as QuestionContent)
  const toggle = (id: string) => {
    if (!multiple) return onContent({ ...c, correct_option_id: id } as QuestionContent)
    const next = correct.has(id) ? [...correct].filter((x) => x !== id) : [...correct, id]
    onContent({ ...c, correct_option_ids: next } as QuestionContent)
  }
  const remove = (id: string) => {
    const options = c.options.filter((o) => o.id !== id)
    if (multiple) setOptions(options, { correct_option_ids: (c.correct_option_ids ?? []).filter((x) => x !== id) })
    else setOptions(options, { correct_option_id: c.correct_option_id === id ? '' : c.correct_option_id })
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{multiple ? 'Tick every correct option (at least two).' : 'Select the one correct option.'}</p>
      <ul className="flex flex-col gap-2">
        {c.options.map((o, i) => (
          <li key={o.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <input
                type={multiple ? 'checkbox' : 'radio'} name="correct" className="size-6 shrink-0" checked={correct.has(o.id)} onChange={() => toggle(o.id)}
                aria-label={`Option ${i + 1} is correct`}
              />
              <input className={field} value={o.text} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1} text`} onChange={(e) => setOptions(c.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))} />
              <button type="button" className={small} onClick={() => remove(o.id)} aria-label={`Remove option ${i + 1}`} disabled={c.options.length <= 2}>Remove</button>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Why this option is right or wrong (optional)</span>
              <input className={field} value={o.explanation ?? ''} aria-label={`Option ${i + 1} explanation`} onChange={(e) => setOptions(c.options.map((x) => (x.id === o.id ? { ...x, explanation: e.target.value } : x)))} />
            </label>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className={small + ' border border-line'} disabled={c.options.length >= MAX_OPTIONS} onClick={() => setOptions([...c.options, { id: nextId(c.options.map((o) => o.id), 'o'), text: '' }])}>Add option</button>
      </div>
      <details className="rounded-xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Scoring (optional)</summary>
        <div className="mt-2 flex flex-col gap-3">
          {multiple ? (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium">Marking
                <select className={field} value={c.scoring?.mode ?? 'exact'} onChange={(e) => onContent(withScoring(c, { mode: e.target.value === 'exact' ? undefined : e.target.value }) as QuestionContent)}>
                  <option value="exact">All or nothing (exact match)</option>
                  <option value="partial">Partial credit</option>
                </select>
              </label>
              {c.scoring?.mode === 'partial' ? <NumberField label="Penalty for each wrong tick (0 to 5, default 1)" value={c.scoring?.penalty_weight} min={0} max={5} step={0.25} onChange={(n) => onContent(withScoring(c, { penalty_weight: n }) as QuestionContent)} /> : null}
            </>
          ) : null}
          <NumberField label="Negative marking for a wrong answer (0 to 1, default none)" value={c.scoring?.negative_marks} min={0} max={1} step={0.25} onChange={(n) => onContent(withScoring(c, { negative_marks: n }) as QuestionContent)} />
        </div>
      </details>
    </div>
  )
}

function TrueFalseEditor({ content, onContent }: { content: TrueFalseContent; onContent: (c: QuestionContent) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">The statement is</legend>
        {([true, false] as const).map((v) => (
          <label key={String(v)} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3">
            <input type="radio" name="tf" className="size-5" checked={content.correct_answer === v} onChange={() => onContent({ ...content, correct_answer: v })} />
            {v ? 'True' : 'False'}
          </label>
        ))}
      </fieldset>
      <NumberField label="Negative marking for a wrong answer (0 to 1, default none)" value={content.scoring?.negative_marks} min={0} max={1} step={0.25} onChange={(n) => onContent(withScoring(content, { negative_marks: n }) as QuestionContent)} />
    </div>
  )
}

function FillGapEditor({ stem, content, onStem, onContent }: { stem: string; content: FillGapContent; onStem: (s: string) => void; onContent: (c: QuestionContent) => void }) {
  const markers = new Set(blankMarkers(stem))
  const setBlank = (id: string, patch: Partial<FillGapContent['blanks'][number]>) => onContent({ ...content, blanks: content.blanks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const add = () => {
    const id = nextId(content.blanks.map((b) => b.id), 'b')
    onStem(`${stem}${stem && !/\s$/.test(stem) ? ' ' : ''}{{${id}}}`)
    onContent({ ...content, blanks: [...content.blanks, { id, accepted_answers: [''] }] })
  }
  const remove = (id: string) => {
    onStem(stem.split(`{{${id}}}`).join('').replace(/ {2,}/g, ' '))
    onContent({ ...content, blanks: content.blanks.filter((b) => b.id !== id) })
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Write the question above. Press “Add blank” to put a blank in it, or type a marker such as {'{{b1}}'} where the missing word goes.</p>
      <ul className="flex flex-col gap-2">
        {content.blanks.map((b, i) => (
          <li key={b.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <p className="mr-auto font-medium">Blank {i + 1} <span className="text-sm font-normal text-muted">({'{{' + b.id + '}}'}{markers.has(b.id) ? '' : ', not in the question yet'})</span></p>
              <button type="button" className={small} onClick={() => remove(b.id)} aria-label={`Remove blank ${i + 1}`} disabled={content.blanks.length <= 1}>Remove</button>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">Accepted answers, one per line
              <textarea
                className={field + ' py-2'} rows={3} aria-label={`Accepted answers for blank ${i + 1}`}
                value={b.accepted_answers.join('\n')}
                onChange={(e) => setBlank(b.id, { accepted_answers: e.target.value.split('\n').slice(0, MAX_ANSWERS_PER_BLANK) })}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={b.case_sensitive ?? false} onChange={(e) => setBlank(b.id, { case_sensitive: e.target.checked || undefined })} /> Capital letters must match for this blank
            </label>
          </li>
        ))}
      </ul>
      <div><button type="button" className={small + ' border border-line'} disabled={content.blanks.length >= MAX_BLANKS} onClick={add}>Add blank</button></div>
      <details className="rounded-xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Marking (optional)</summary>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={content.normalization?.case_sensitive ?? false} onChange={(e) => onContent({ ...content, normalization: { ...content.normalization, case_sensitive: e.target.checked || undefined } })} /> Capital letters must match (all blanks)
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={content.normalization?.strip_punctuation ?? false} onChange={(e) => onContent({ ...content, normalization: { ...content.normalization, strip_punctuation: e.target.checked || undefined } })} /> Ignore punctuation
          </label>
          {content.blanks.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm font-medium">Marking with several blanks
              <select className={field} value={content.scoring?.mode ?? 'partial'} onChange={(e) => onContent({ ...content, scoring: e.target.value === 'partial' ? undefined : { mode: 'all_or_nothing' } })}>
                <option value="partial">Partial credit for each correct blank</option>
                <option value="all_or_nothing">All blanks right or no credit</option>
              </select>
            </label>
          ) : null}
        </div>
      </details>
    </div>
  )
}
