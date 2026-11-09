import type { WQuestion } from '../questions/repo'
import { validateQuestion } from '../questions/schema'
import type { WAttempt, WSession } from '../session/repo'
import type { WSubject, WTopic } from './model'

export type Severity = 'problem' | 'note'
export interface Finding {
  id: string
  severity: Severity
  /** How many items are affected. */
  count: number
  /** What is wrong, in plain words. */
  title: string
  /** What to do about it. */
  advice: string
  /** Where to fix it, if there is a screen for it. */
  to?: string
  /** A few examples (question wording, names), never more than 3. */
  examples: string[]
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const DAY = 86400000

export interface HealthInput {
  subjects: Pick<WSubject, 'id' | 'name'>[]
  topics: Pick<WTopic, 'id' | 'name' | 'subjectId' | 'parentId'>[]
  tags: { id: string; name: string }[]
  questions: WQuestion[]
  sessions: Pick<WSession, 'id' | 'title' | 'status' | 'startedAt' | 'questionIds'>[]
  attempts: Pick<WAttempt, 'id' | 'questionId'>[]
  now: Date
}

/** Looks for things that are inconsistent in the data on this device. Read-only: it never changes anything. */
export function checkHealth(x: HealthInput): Finding[] {
  const out: Finding[] = []
  const add = (f: Omit<Finding, 'count' | 'examples'> & { items: string[] }) => { if (f.items.length) out.push({ id: f.id, severity: f.severity, title: f.title, advice: f.advice, to: f.to, count: f.items.length, examples: f.items.slice(0, 3) }) }
  const subjectIds = new Set(x.subjects.map((s) => s.id))
  const topicById = new Map(x.topics.map((t) => [t.id, t]))
  const tagIds = new Set(x.tags.map((t) => t.id))
  const questionIds = new Set(x.questions.map((q) => q.id))
  const label = (q: WQuestion) => short(q.stem.replace(/\s+/g, ' '))

  add({ id: 'invalid-question', severity: 'problem', title: 'Questions whose answer data is not valid', advice: 'Open each one and save it again, or archive it. They cannot be practised until they are fixed.',
    to: '/app/workspace/questions', items: x.questions.filter((q) => !q.deleted && !validateQuestion(q.type, q.stem, q.content).ok).map(label) })
  add({ id: 'no-subject', severity: 'problem', title: 'Questions whose subject is missing', advice: 'Open the question and choose a subject for it.',
    to: '/app/workspace/questions', items: x.questions.filter((q) => !q.deleted && !subjectIds.has(q.subjectId)).map(label) })
  add({ id: 'topic-missing', severity: 'problem', title: 'Questions linked to a topic that no longer exists', advice: 'Open the question and pick its topics again.',
    to: '/app/workspace/questions', items: x.questions.filter((q) => !q.deleted && q.topicIds.some((t) => !topicById.has(t))).map(label) })
  add({ id: 'topic-other-subject', severity: 'problem', title: 'Questions with a topic from a different subject', advice: 'Open the question and fix its subject or its topics.',
    to: '/app/workspace/questions', items: x.questions.filter((q) => !q.deleted && q.topicIds.some((t) => { const tp = topicById.get(t); return tp && tp.subjectId !== q.subjectId })).map(label) })
  add({ id: 'tag-missing', severity: 'problem', title: 'Questions linked to a tag that no longer exists', advice: 'Open the question and choose its tags again.',
    to: '/app/workspace/questions', items: x.questions.filter((q) => !q.deleted && q.tagIds.some((t) => !tagIds.has(t))).map(label) })
  add({ id: 'topic-orphan', severity: 'problem', title: 'Topics whose subject or parent topic is missing', advice: 'Open My subjects and move or archive them.',
    to: '/app/workspace/subjects', items: x.topics.filter((t) => !subjectIds.has(t.subjectId) || (t.parentId !== null && !topicById.has(t.parentId))).map((t) => t.name) })
  add({ id: 'attempt-orphan', severity: 'note', title: 'Saved answers for questions that are not on this device', advice: 'Nothing to do. They stay in your history and will show again when the question syncs.',
    items: x.attempts.filter((a) => !questionIds.has(a.questionId)).map((a) => a.id) })
  add({ id: 'session-orphan', severity: 'note', title: 'Sessions that include questions not on this device', advice: 'Nothing to do. Those questions are skipped when you review the session.',
    to: '/app/workspace/sessions', items: x.sessions.filter((s) => s.questionIds.some((id) => !questionIds.has(id))).map((s) => s.title) })
  add({ id: 'old-unfinished', severity: 'note', title: 'Sessions left unfinished for more than 30 days', advice: 'Continue them or press Stop without a result.',
    to: '/app/workspace/sessions', items: x.sessions.filter((s) => s.status === 'in_progress' && x.now.getTime() - new Date(s.startedAt).getTime() > 30 * DAY).map((s) => s.title) })
  return out
}

export interface StorageInfo { usedBytes: number | null; quotaBytes: number | null; persistent: boolean | null }

/** What the browser says about space used by this app on this device. Not every browser can tell. */
export async function readStorage(nav: Pick<Navigator, 'storage'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<StorageInfo> {
  const st = nav?.storage
  if (!st) return { usedBytes: null, quotaBytes: null, persistent: null }
  const [est, persistent] = await Promise.all([
    st.estimate ? st.estimate().catch(() => null) : Promise.resolve(null),
    st.persisted ? st.persisted().catch(() => null) : Promise.resolve(null),
  ])
  return { usedBytes: est?.usage ?? null, quotaBytes: est?.quota ?? null, persistent }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
