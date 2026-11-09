import { useMemo, useState } from 'react'
import { Button } from '../../components/ui'
import { grade, type GradeResult } from '../grade'
import { shuffled } from '../registry'
import type { MultipleContent, SbaContent } from '../schema'
import AnswerArea, { type Response, type ViewQuestion } from './AnswerArea'
import AnswerFeedback from './AnswerFeedback'

export type { Response, ViewQuestion }


/**
 * One question the way a learner sees it: answer, check, feedback. Used by the editor's preview now and by
 * practice and exams later. `seed` fixes the option order, so a question looks the same when reviewed.
 */
export default function QuestionView({ question, seed, onGraded, shuffleOptions = false, allowRetry = true }: { question: ViewQuestion; seed?: number; onGraded?: (r: GradeResult, response: Response) => void; shuffleOptions?: boolean; allowRetry?: boolean }) {
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

  return (
    <div className="flex flex-col gap-4">
      <AnswerArea question={q} options={options} response={resp} onChange={setResp} done={done} result={result} />

      {!done ? (
        <div><Button onClick={check}>Check answer</Button></div>
      ) : (
        <AnswerFeedback question={q} result={result} onRetry={allowRetry ? again : undefined} />
      )}
    </div>
  )
}
