import type { ExamStyle, Question, QuestionFormat, Subject, Topic } from './schema'
import type { ValidContent } from './validate'
import { isStudentVisible } from './visibility'

/** What the browser downloads. Questions are split per subject so a student only fetches what they open. */
export interface Taxonomy {
  subjects: Subject[]
  topics: Topic[]
  formats: QuestionFormat[]
  examStyles: ExamStyle[]
}

export interface ManifestSubject {
  id: string
  questionCount: number
  /** Path relative to /content/, e.g. "questions/anatomy.json". */
  file: string
}

export interface Manifest {
  schemaVersion: 1
  /** Changes whenever any shipped content changes. Used for cache busting and recorded on attempts. */
  contentVersion: string
  includesDemo: boolean
  totalQuestions: number
  subjects: ManifestSubject[]
}

export interface Bundle {
  manifest: Manifest
  taxonomy: Taxonomy
  questionFiles: Record<string, Question[]>
}

/**
 * Turns validated content into the static files the app serves.
 * Only student-visible questions in active subjects/topics are shipped, so drafts and
 * unreviewed content are never published to the public site.
 */
export function buildBundle(
  content: ValidContent,
  opts: { includeDemo: boolean },
  sha256Hex: (input: string) => string,
): Bundle {
  const activeSubjects = content.subjects.filter((s) => s.isActive)
  const activeSubjectIds = new Set(activeSubjects.map((s) => s.id))
  const activeTopics = content.topics.filter((t) => t.isActive && activeSubjectIds.has(t.subjectId))
  const activeTopicIds = new Set(activeTopics.map((t) => t.id))

  const questionFiles: Record<string, Question[]> = {}
  for (const q of content.questions) {
    if (!isStudentVisible(q, { allowDemo: opts.includeDemo })) continue
    if (!activeSubjectIds.has(q.subjectId) || !activeTopicIds.has(q.topicId)) continue
    ;(questionFiles[q.subjectId] ??= []).push(q)
  }
  for (const list of Object.values(questionFiles)) list.sort((a, b) => a.id.localeCompare(b.id))

  const taxonomy: Taxonomy = {
    subjects: [...activeSubjects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    topics: [...activeTopics].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    formats: content.formats,
    examStyles: content.examStyles,
  }

  const subjects: ManifestSubject[] = Object.keys(questionFiles)
    .sort()
    .map((id) => ({ id, questionCount: questionFiles[id].length, file: `questions/${id}.json` }))

  const contentVersion = sha256Hex(JSON.stringify({ taxonomy, questionFiles })).slice(0, 16)

  return {
    manifest: {
      schemaVersion: 1,
      contentVersion,
      includesDemo: opts.includeDemo,
      totalQuestions: subjects.reduce((n, s) => n + s.questionCount, 0),
      subjects,
    },
    taxonomy,
    questionFiles,
  }
}
