import type { FillGapContent, MultipleContent, QuestionContent, QuestionType, SbaContent, TrueFalseContent } from '../questions/schema'

/** A question's answers as plain lines for read-only views (history). A correct option starts with "✓". */
export function describeContent(type: QuestionType, content: unknown): string[] {
  const c = content as QuestionContent
  if (type === 'SBA') { const s = c as SbaContent; return s.options.map((o) => `${o.id === s.correct_option_id ? '✓' : '•'} ${o.text}`) }
  if (type === 'MULTIPLE_MCQ') { const m = c as MultipleContent; return m.options.map((o) => `${m.correct_option_ids.includes(o.id) ? '✓' : '•'} ${o.text}`) }
  if (type === 'TRUE_FALSE') return [`Answer: ${(c as TrueFalseContent).correct_answer ? 'True' : 'False'}`]
  return (c as FillGapContent).blanks.map((b) => `Blank ${b.id}: ${b.accepted_answers.join(' | ')}`)
}
