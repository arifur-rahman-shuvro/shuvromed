import { stemKey, type WQuestion } from '../questions/repo'
import { MAX_EXPLANATION, MAX_REFERENCE, validateQuestion } from '../questions/schema'
import { MAX_SUBJECT_NAME, MAX_TOPIC_NAME, cleanName, normName, type WSubject, type WTopic } from '../workspace/model'
import type { WTag } from '../tags/repo'
import type { ImportItem, ReadFailure, ReadResult } from './types'

export interface Snapshot { subjects: WSubject[]; topics: WTopic[]; tags: WTag[]; questions: Pick<WQuestion, 'stem'>[] }
export interface PlanOptions { /** What to do with a question whose wording already exists: leave it out (default) or add it anyway. */ duplicates: 'skip' | 'add' }

export interface PlanItem {
  label: string
  status: 'add' | 'duplicate' | 'error'
  problems: string[]
  /** The cleaned item, ready to save. Present unless status is 'error'. */
  item: ImportItem | null
  duplicateOf?: 'existing' | 'file'
}
export interface Plan {
  items: PlanItem[]
  /** Questions that could not even be read. */
  unreadable: ReadFailure[]
  newSubjects: string[]
  newTopics: string[]
  newTags: { category: 'exam' | 'general'; name: string }[]
  counts: { add: number; duplicate: number; error: number }
  /** Set when the whole file is unusable. */
  fatal: string | null
}

const dedupe = (names: string[]): string[] => { const seen = new Set<string>(); return names.filter((n) => { const k = normName(n); if (!k || seen.has(k)) return false; seen.add(k); return true }) }

/**
 * A dry run: says what an import WOULD do, and saves nothing. The same plan is what the import then carries out,
 * so the report you read is the result you get.
 */
export function buildPlan(read: ReadResult, snap: Snapshot, opts: PlanOptions = { duplicates: 'skip' }): Plan {
  const plan: Plan = { items: [], unreadable: read.failures, newSubjects: [], newTopics: [], newTags: [], counts: { add: 0, duplicate: 0, error: 0 }, fatal: read.fatal }
  if (read.fatal) return plan
  const existing = new Set(snap.questions.map((q) => stemKey(q.stem)))
  const seenInFile = new Set<string>()
  const subjectKeys = new Set(snap.subjects.map((s) => normName(s.name)))
  const topicKeys = new Set<string>() // "subjectKey|a|b" for topics that already exist or are planned
  const byId = new Map(snap.topics.map((t) => [t.id, t]))
  const pathOf = (t: WTopic): string[] => { const out: string[] = []; let c: WTopic | undefined = t; const seen = new Set<string>(); while (c && !seen.has(c.id)) { seen.add(c.id); out.unshift(normName(c.name)); c = c.parentId ? byId.get(c.parentId) : undefined } return out }
  const subjectNameById = new Map(snap.subjects.map((s) => [s.id, normName(s.name)]))
  for (const t of snap.topics) topicKeys.add([subjectNameById.get(t.subjectId) ?? '', ...pathOf(t)].join('|'))
  const tagKeys = new Set(snap.tags.map((t) => `${t.category}|${normName(t.name)}`))

  for (const { label, item } of read.items) {
    const problems: string[] = []
    const subject = cleanName(item.subject)
    if (!subject) problems.push('No subject.')
    else if (subject.length > MAX_SUBJECT_NAME) problems.push(`Subject name is longer than ${MAX_SUBJECT_NAME} characters.`)
    const topics = item.topics.map((p) => p.map(cleanName).filter(Boolean)).filter((p) => p.length)
    for (const p of topics) for (const name of p) if (name.length > MAX_TOPIC_NAME) problems.push(`Topic "${name.slice(0, 30)}…" is longer than ${MAX_TOPIC_NAME} characters.`)
    const exam = dedupe(item.examTags.map(cleanName))
    const general = dedupe(item.generalTags.map(cleanName))
    for (const n of [...exam, ...general]) if (n.length > 80) problems.push(`Tag "${n.slice(0, 30)}…" is longer than 80 characters.`)
    if (exam.length + general.length > 60) problems.push('A question can have at most 60 tags.')
    if (topics.length > 30) problems.push('A question can have at most 30 topics.')
    const v = validateQuestion(item.type, item.stem, item.content)
    if (!v.ok) for (const p of v.problems.slice(0, 3)) problems.push(p.message)
    if ((item.explanation ?? '').length > MAX_EXPLANATION) problems.push(`Explanation is longer than ${MAX_EXPLANATION} characters.`)
    if ((item.reference ?? '').length > MAX_REFERENCE) problems.push(`Reference is longer than ${MAX_REFERENCE} characters.`)
    if (problems.length || !v.ok) { plan.items.push({ label, status: 'error', problems, item: null }); plan.counts.error++; continue }

    const clean: ImportItem = { ...item, subject, topics, examTags: exam, generalTags: general, stem: v.stem, content: v.content }
    const key = stemKey(v.stem)
    const dupOf = existing.has(key) ? 'existing' : seenInFile.has(key) ? 'file' : undefined
    seenInFile.add(key)
    if (dupOf && opts.duplicates === 'skip') {
      plan.items.push({ label, status: 'duplicate', problems: [dupOf === 'existing' ? 'Same wording as a question you already have.' : 'Same wording as an earlier question in this file.'], item: clean, duplicateOf: dupOf })
      plan.counts.duplicate++
      continue
    }
    plan.items.push({ label, status: 'add', problems: dupOf ? ['Same wording as another question (added anyway).'] : [], item: clean, duplicateOf: dupOf })
    plan.counts.add++

    const sKey = normName(subject)
    if (!subjectKeys.has(sKey)) { subjectKeys.add(sKey); plan.newSubjects.push(subject) }
    for (const path of topics) {
      for (let i = 1; i <= path.length; i++) {
        const k = [sKey, ...path.slice(0, i).map(normName)].join('|')
        if (!topicKeys.has(k)) { topicKeys.add(k); plan.newTopics.push(`${subject} › ${path.slice(0, i).join(' › ')}`) }
      }
    }
    for (const [category, names] of [['exam', exam], ['general', general]] as const) {
      for (const name of names) {
        const k = `${category}|${normName(name)}`
        if (!tagKeys.has(k)) { tagKeys.add(k); plan.newTags.push({ category, name }) }
      }
    }
  }
  return plan
}
