import type { QuestionInput, QuestionRepo } from '../questions/repo'
import type { TagRepo } from '../tags/repo'
import { normName } from '../workspace/model'
import type { WorkspaceRepo } from '../workspace/repo'
import type { Plan } from './plan'

export interface ImportSummary {
  added: number
  failed: { label: string; error: string }[]
  createdSubjects: number
  createdTopics: number
  createdTags: number
}
export interface Repos { ws: WorkspaceRepo; tags: TagRepo; questions: QuestionRepo }

/**
 * Carries out a plan: first the subjects, topics and tags it needs, then the questions in batches. Everything is saved
 * on the device (and sent by the normal sync later), so it works offline. Nothing that already exists is changed.
 */
export async function runImport(plan: Plan, repos: Repos, onProgress?: (done: number, total: number) => void): Promise<{ data: ImportSummary | null; error: string | null }> {
  const todo = plan.items.filter((i) => i.status === 'add' && i.item)
  const summary: ImportSummary = { added: 0, failed: [], createdSubjects: 0, createdTopics: 0, createdTags: 0 }
  if (!todo.length) return { data: summary, error: null }

  const loaded = await repos.ws.load()
  const tagList = await repos.tags.list()
  if (loaded.error || !loaded.data || tagList.error || !tagList.data) return { data: null, error: loaded.error ?? tagList.error ?? 'Could not read your workspace.' }
  const subjects = new Map(loaded.data.subjects.map((s) => [normName(s.name), s.id]))
  const topics = [...loaded.data.topics]
  const tags = new Map(tagList.data.map((t) => [`${t.category}|${normName(t.name)}`, t.id]))

  const subjectId = async (name: string): Promise<string> => {
    const k = normName(name)
    const have = subjects.get(k)
    if (have) return have
    const r = await repos.ws.createSubject(name, null)
    if (r.error || !r.data) throw new Error(`Could not create subject "${name}": ${r.error}`)
    subjects.set(k, r.data.id); summary.createdSubjects++
    return r.data.id
  }
  const topicId = async (sid: string, path: string[]): Promise<string> => {
    let parent: string | null = null
    for (const name of path) {
      let hit = topics.find((t) => t.subjectId === sid && (t.parentId ?? null) === parent && normName(t.name) === normName(name))
      if (!hit) {
        const r = await repos.ws.createTopic(sid, parent, name)
        if (r.error || !r.data) throw new Error(`Could not create topic "${name}": ${r.error}`)
        hit = r.data; topics.push(hit); summary.createdTopics++
      }
      parent = hit.id
    }
    return parent as string
  }
  const tagId = async (category: 'exam' | 'general', name: string): Promise<string> => {
    const k = `${category}|${normName(name)}`
    const have = tags.get(k)
    if (have) return have
    const r = await repos.tags.create(category, name)
    if (r.error || !r.data) throw new Error(`Could not create tag "${name}": ${r.error}`)
    tags.set(k, r.data.id); summary.createdTags++
    return r.data.id
  }

  try {
    const inputs: QuestionInput[] = []
    for (const p of todo) {
      const it = p.item!
      const sid = await subjectId(it.subject)
      const topicIds: string[] = []
      for (const path of it.topics) topicIds.push(await topicId(sid, path)) // one after another, so two paths never create the same parent twice
      const tagIds: string[] = []
      for (const n of it.examTags) tagIds.push(await tagId('exam', n))
      for (const n of it.generalTags) tagIds.push(await tagId('general', n))
      inputs.push({ subjectId: sid, type: it.type, stem: it.stem, difficulty: it.difficulty, content: it.content, explanation: it.explanation, reference: it.reference, topicIds: [...new Set(topicIds)], tagIds })
    }
    const CHUNK = 200
    for (let start = 0; start < inputs.length; start += CHUNK) {
      const r = await repos.questions.createMany(inputs.slice(start, start + CHUNK))
      if (r.error || !r.data) return { data: summary, error: r.error ?? 'Could not save the questions.' }
      summary.added += r.data.created
      for (const f of r.data.failed) summary.failed.push({ label: todo[start + f.index].label, error: f.error })
      onProgress?.(Math.min(start + CHUNK, inputs.length), inputs.length)
    }
  } catch (e) {
    return { data: summary, error: e instanceof Error ? e.message : 'Something went wrong during the import.' }
  }
  return { data: summary, error: null }
}
