import type { Difficulty, QuestionContent, QuestionType } from '../questions/schema'

export const FILE_FORMAT = 'shuvromed-questions'
export const FILE_VERSION = 1

/** One question as it travels in a file or a paste: everything is by NAME, never by id, so a file works on any account. */
export interface ImportItem {
  subject: string
  /** Each entry is one topic as a path from the top, for example ['Heart', 'Valves']. */
  topics: string[][]
  examTags: string[]
  generalTags: string[]
  type: QuestionType
  stem: string
  difficulty: Difficulty | null
  content: QuestionContent
  explanation: string | null
  reference: string | null
}

/** A question that could not even be read (the wording or shape is wrong) before any checking against the data. */
export interface ReadFailure { label: string; problems: string[] }
export interface ReadResult { items: { label: string; item: ImportItem }[]; failures: ReadFailure[]; fatal: string | null }
