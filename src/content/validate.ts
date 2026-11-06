import {
  ExamStyleSchema,
  QuestionFormatSchema,
  QuestionSchema,
  SubjectSchema,
  TopicSchema,
  type ExamStyle,
  type Question,
  type QuestionFormat,
  type Subject,
  type Topic,
} from './schema'

export type Severity = 'error' | 'warning'

export interface Issue {
  severity: Severity
  /** Stable machine-readable code, e.g. "unknown-topic". */
  code: string
  /** Where the record came from, e.g. "content/questions/demo.json[3]". */
  source: string
  /** The record id, when it could be read. */
  id?: string
  message: string
}

/** One raw record plus a label saying where it came from, so errors point at the right file. */
export interface Sourced {
  source: string
  data: unknown
}

export interface ContentInput {
  subjects: Sourced[]
  topics: Sourced[]
  formats: Sourced[]
  examStyles: Sourced[]
  questions: Sourced[]
}

export interface ValidContent {
  subjects: Subject[]
  topics: Topic[]
  formats: QuestionFormat[]
  examStyles: ExamStyle[]
  questions: Question[]
}

export interface Report {
  /** True only when there are no errors. Warnings never block. */
  ok: boolean
  errors: Issue[]
  warnings: Issue[]
  /** Records that passed schema validation. Only rely on this when ok is true. */
  content: ValidContent
  stats: {
    subjects: number
    topics: number
    questions: number
    questionsByStatus: Record<string, number>
    demoQuestions: number
  }
}

interface Parsed<T> {
  value: T
  source: string
}

function readId(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'id' in data && typeof (data as { id: unknown }).id === 'string') {
    return (data as { id: string }).id
  }
  return undefined
}

export function validateContent(input: ContentInput): Report {
  const issues: Issue[] = []
  const add = (severity: Severity, code: string, source: string, message: string, id?: string) =>
    issues.push({ severity, code, source, message, id })

  function parseAll<T>(
    items: Sourced[],
    schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
    label: string,
  ): Parsed<T>[] {
    const out: Parsed<T>[] = []
    for (const item of items) {
      const r = schema.safeParse(item.data)
      if (r.success) {
        out.push({ value: r.data, source: item.source })
      } else {
        const id = readId(item.data)
        for (const i of r.error.issues) {
          const where = i.path.length ? `${i.path.map(String).join('.')}: ` : ''
          add('error', 'schema', item.source, `${label} ${where}${i.message}`, id)
        }
      }
    }
    return out
  }

  const subjects = parseAll<Subject>(input.subjects, SubjectSchema, 'subject')
  const topics = parseAll<Topic>(input.topics, TopicSchema, 'topic')
  const formats = parseAll<QuestionFormat>(input.formats, QuestionFormatSchema, 'format')
  const examStyles = parseAll<ExamStyle>(input.examStyles, ExamStyleSchema, 'examStyle')
  const questions = parseAll<Question>(input.questions, QuestionSchema, 'question')

  function checkDuplicates<T extends { id: string }>(items: Parsed<T>[], label: string) {
    const seen = new Map<string, string>()
    for (const it of items) {
      const first = seen.get(it.value.id)
      if (first) {
        add('error', 'duplicate-id', it.source, `duplicate ${label} id "${it.value.id}" (first defined in ${first})`, it.value.id)
      } else {
        seen.set(it.value.id, it.source)
      }
    }
  }
  checkDuplicates(subjects, 'subject')
  checkDuplicates(topics, 'topic')
  checkDuplicates(formats, 'format')
  checkDuplicates(examStyles, 'exam style')
  checkDuplicates(questions, 'question')

  const subjectById = new Map(subjects.map((s) => [s.value.id, s.value]))
  const topicById = new Map(topics.map((t) => [t.value.id, t.value]))
  const formatById = new Map(formats.map((f) => [f.value.id, f.value]))
  const styleIds = new Set(examStyles.map((e) => e.value.id))

  // Topics: subject and parent must exist, parent must share the subject, and there must be no cycles.
  for (const t of topics) {
    const v = t.value
    if (!subjectById.has(v.subjectId)) {
      add('error', 'unknown-subject', t.source, `topic "${v.id}" refers to unknown subject "${v.subjectId}"`, v.id)
    }
    if (v.parentId !== null) {
      const parent = topicById.get(v.parentId)
      if (!parent) {
        add('error', 'unknown-parent', t.source, `topic "${v.id}" refers to unknown parent "${v.parentId}"`, v.id)
      } else if (parent.subjectId !== v.subjectId) {
        add('error', 'parent-subject-mismatch', t.source, `topic "${v.id}" is in subject "${v.subjectId}" but its parent "${v.parentId}" is in "${parent.subjectId}"`, v.id)
      }
    }
  }
  for (const t of topics) {
    const seen = new Set<string>()
    let cur: Topic | undefined = t.value
    while (cur) {
      if (seen.has(cur.id)) {
        add('error', 'topic-cycle', t.source, `topic "${t.value.id}" is part of a parent cycle`, t.value.id)
        break
      }
      seen.add(cur.id)
      cur = cur.parentId ? topicById.get(cur.parentId) : undefined
    }
  }

  // Questions: cross references against the taxonomy, formats and exam styles.
  for (const q of questions) {
    const v = q.value
    const subject = subjectById.get(v.subjectId)
    const topic = topicById.get(v.topicId)
    if (!subject) add('error', 'unknown-subject', q.source, `question "${v.id}" refers to unknown subject "${v.subjectId}"`, v.id)
    if (!topic) {
      add('error', 'unknown-topic', q.source, `question "${v.id}" refers to unknown topic "${v.topicId}"`, v.id)
    } else if (topic.subjectId !== v.subjectId) {
      add('error', 'topic-subject-mismatch', q.source, `question "${v.id}" has subject "${v.subjectId}" but topic "${v.topicId}" belongs to "${topic.subjectId}"`, v.id)
    }
    const format = formatById.get(v.format)
    if (!format) {
      add('error', 'unknown-format', q.source, `question "${v.id}" uses unknown format "${v.format}"`, v.id)
    } else if (v.options.length < format.minOptions || v.options.length > format.maxOptions) {
      const want = format.minOptions === format.maxOptions ? `${format.minOptions}` : `${format.minOptions}-${format.maxOptions}`
      add('error', 'option-count', q.source, `question "${v.id}" has ${v.options.length} options but format "${format.id}" needs ${want}`, v.id)
    }
    for (const tag of v.examTags) {
      if (!styleIds.has(tag)) add('error', 'unknown-exam-tag', q.source, `question "${v.id}" uses unknown exam style "${tag}"`, v.id)
    }
    if (subject && !subject.isActive) add('warning', 'inactive-subject', q.source, `question "${v.id}" is in inactive subject "${subject.id}"`, v.id)
    if (topic && !topic.isActive) add('warning', 'inactive-topic', q.source, `question "${v.id}" is in inactive topic "${topic.id}"`, v.id)
    if (v.stem.length < 30) add('warning', 'short-stem', q.source, `question "${v.id}" has a very short stem (${v.stem.length} characters)`, v.id)
    // Options can be shuffled for students, so wording like "Option C is wrong" would mislead.
    if (!v.fixedOptionOrder) {
      const letterRef = /\b(?:[Oo]ption|[Aa]nswer|[Cc]hoice)s?\s+\(?[A-E]\)?\b/
      const texts = [v.explanation, v.clinicalPearl ?? '', ...Object.values(v.optionAnalysis)]
      if (texts.some((t) => letterRef.test(t))) {
        add('warning', 'option-letter-reference', q.source, `question "${v.id}" refers to an option by letter, which breaks when options are shuffled (or set fixedOptionOrder)`, v.id)
      }
    }
    if (v.status === 'published' && v.learningObjectives.length === 0) {
      add('warning', 'no-learning-objectives', q.source, `published question "${v.id}" has no learning objectives`, v.id)
    }
  }

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const questionsByStatus: Record<string, number> = {}
  for (const q of questions) questionsByStatus[q.value.status] = (questionsByStatus[q.value.status] ?? 0) + 1

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    content: {
      subjects: subjects.map((s) => s.value),
      topics: topics.map((t) => t.value),
      formats: formats.map((f) => f.value),
      examStyles: examStyles.map((e) => e.value),
      questions: questions.map((q) => q.value),
    },
    stats: {
      subjects: subjects.length,
      topics: topics.length,
      questions: questions.length,
      questionsByStatus,
      demoQuestions: questions.filter((q) => q.value.isDemo).length,
    },
  }
}

export function formatIssue(i: Issue): string {
  return `${i.severity === 'error' ? 'ERROR' : 'warn '} [${i.code}] ${i.source}: ${i.message}`
}
