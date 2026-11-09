import type { WQuestion } from '../questions/repo'
import type { WTag } from '../tags/repo'
import type { WSubject, WTopic } from '../workspace/model'
import type { QuestionFile } from './file'
import { FILE_FORMAT, FILE_VERSION } from './types'

/** Everything you own as one JSON file. It is the same format the importer reads, so an export can be imported back (or into another account). */
export function buildExport(data: { subjects: WSubject[]; topics: WTopic[]; tags: WTag[]; questions: WQuestion[] }, now: Date = new Date()): QuestionFile {
  const subject = new Map(data.subjects.map((s) => [s.id, s.name]))
  const topic = new Map(data.topics.map((t) => [t.id, t]))
  const tag = new Map(data.tags.map((t) => [t.id, t]))
  const pathOf = (id: string): string[] => {
    const out: string[] = []; const seen = new Set<string>()
    let c = topic.get(id)
    while (c && !seen.has(c.id)) { seen.add(c.id); out.unshift(c.name); c = c.parentId ? topic.get(c.parentId) : undefined }
    return out
  }
  const questions = data.questions
    .filter((q) => !q.deleted)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    .map((q) => ({
      subject: subject.get(q.subjectId) ?? 'Unknown subject',
      topics: q.topicIds.map(pathOf).filter((p) => p.length),
      exam_tags: q.tagIds.map((id) => tag.get(id)).filter((t): t is WTag => !!t && t.category === 'exam').map((t) => t.name),
      tags: q.tagIds.map((id) => tag.get(id)).filter((t): t is WTag => !!t && t.category === 'general').map((t) => t.name),
      type: q.type, stem: q.stem, content: q.content, difficulty: q.difficulty, explanation: q.explanation, reference: q.reference,
    }))
  return { format: FILE_FORMAT, version: FILE_VERSION, exported_at: now.toISOString(), questions }
}

export const exportFileName = (now: Date = new Date()): string => `shuvromed-questions-${now.toISOString().slice(0, 10)}.json`
