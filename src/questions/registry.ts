import type { FillGapContent, MultipleContent, QuestionContent, QuestionType, SbaContent, TrueFalseContent } from './schema'

export interface TypeInfo {
  label: string
  short: string
  description: string
  /** A fresh, valid-shaped starting point for the editor (the person still has to fill it in). */
  blank(): QuestionContent
}

export const TYPE_INFO: Record<QuestionType, TypeInfo> = {
  SBA: {
    label: 'Single best answer',
    short: 'SBA',
    description: 'One correct option out of several.',
    blank: () => ({ options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }, { id: 'e', text: '' }], correct_option_id: '' }),
  },
  MULTIPLE_MCQ: {
    label: 'Multiple correct answers',
    short: 'Multiple',
    description: 'Two or more correct options; choose them all.',
    blank: () => ({ options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }], correct_option_ids: [] }),
  },
  TRUE_FALSE: {
    label: 'True / False',
    short: 'T/F',
    description: 'A statement that is either true or false.',
    blank: () => ({ correct_answer: true }),
  },
  FILL_GAP: {
    label: 'Fill in the gap',
    short: 'Gap',
    description: 'Type the missing word or words.',
    blank: () => ({ blanks: [{ id: 'b1', accepted_answers: [''] }] }),
  },
}

/** Plain text used by search (Phase 7): wording, options, accepted answers, explanation. */
export function searchText(q: { question_type: QuestionType; stem: string; content: QuestionContent; explanation?: string | null; reference?: string | null }): string {
  const parts: string[] = [q.stem.replace(/\{\{[^}]*\}\}/g, ' ___ ')]
  if (q.question_type === 'SBA' || q.question_type === 'MULTIPLE_MCQ') for (const o of (q.content as SbaContent | MultipleContent).options) parts.push(o.text, o.explanation ?? '')
  if (q.question_type === 'FILL_GAP') for (const b of (q.content as FillGapContent).blanks) parts.push(...b.accepted_answers)
  if (q.question_type === 'TRUE_FALSE') parts.push((q.content as TrueFalseContent).correct_answer ? 'true' : 'false')
  parts.push(q.explanation ?? '', q.reference ?? '')
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase()
}

/** The stem as a short single line for lists. */
export const stemPreview = (stem: string, max = 140): string => {
  const t = stem.replace(/\{\{[^}]*\}\}/g, '____').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** Deterministic option order for practice (same seed, same order). Seed per attempt so a question looks the same on review. */
export function shuffled<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
