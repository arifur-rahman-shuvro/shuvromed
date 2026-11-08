import { createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'
import type { WSubject, WTopic } from './model'

export interface Result<T = void> { data: T | null; error: string | null }

export interface WorkspaceRepo {
  load(): Promise<Result<{ subjects: WSubject[]; topics: WTopic[] }>>
  /** Number of live (not deleted) questions under a subject or a topic, and child topics. */
  subjectUse(id: string): Promise<Result<{ topics: number; questions: number }>>
  topicUse(id: string): Promise<Result<{ topics: number; questions: number }>>
  createSubject(name: string, description: string | null): Promise<Result<WSubject>>
  updateSubject(id: string, patch: { name?: string; description?: string | null; archived?: boolean }): Promise<Result<WSubject>>
  deleteSubject(id: string): Promise<Result>
  createTopic(subjectId: string, parentId: string | null, name: string): Promise<Result<WTopic>>
  updateTopic(id: string, patch: { name?: string; parentId?: string | null; archived?: boolean }): Promise<Result<WTopic>>
  deleteTopic(id: string): Promise<Result>
}

const NOT_READY = 'Your private workspace is not set up on the server yet.'
const friendly = (e: { code?: string; message?: string } | null): string | null => {
  if (!e) return null
  if (e.code === '23505') return 'That name is already used here.'
  if (e.code === '23503') return 'This still has items inside it. Move or remove them first.'
  if (e.code === '23514') return e.message ?? 'That change is not allowed.'
  if (e.code === '42P01' || e.code === 'PGRST205') return NOT_READY
  if (e.code === '42501') return 'You are not allowed to do that.'
  return e.message || 'Something went wrong. Please try again.'
}

type SubjectRow = { id: string; name: string; description: string | null; archived_at: string | null; row_version: number }
type TopicRow = { id: string; subject_id: string; parent_id: string | null; name: string; archived_at: string | null; row_version: number }
const subj = (r: SubjectRow): WSubject => ({ id: r.id, name: r.name, description: r.description, archived: r.archived_at !== null, rowVersion: r.row_version })
const topic = (r: TopicRow): WTopic => ({ id: r.id, subjectId: r.subject_id, parentId: r.parent_id, name: r.name, archived: r.archived_at !== null, rowVersion: r.row_version })
const SUBJ_COLS = 'id,name,description,archived_at,row_version'
const TOPIC_COLS = 'id,subject_id,parent_id,name,archived_at,row_version'

export function supabaseWorkspaceRepo(): WorkspaceRepo {
  const sb = supabase
  const none = <T,>(): Promise<Result<T>> => Promise.resolve({ data: null, error: 'The server is not configured.' })
  if (!sb) {
    return { load: () => none(), subjectUse: () => none(), topicUse: () => none(), createSubject: () => none(), updateSubject: () => none(), deleteSubject: () => none(), createTopic: () => none(), updateTopic: () => none(), deleteTopic: () => none() }
  }
  const guard = async <T,>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
    try { return await fn() } catch (e) { return { data: null, error: e instanceof Error ? e.message : 'Something went wrong.' } }
  }
  const archivedAt = (a: boolean | undefined) => (a === undefined ? {} : { archived_at: a ? new Date().toISOString() : null })
  return {
    load: () => guard(async () => {
      const [s, t] = await Promise.all([
        sb.from('user_subjects').select(SUBJ_COLS).order('name').limit(2000),
        sb.from('user_topics').select(TOPIC_COLS).order('name').limit(20000),
      ])
      const err = friendly(s.error) ?? friendly(t.error)
      if (err) return { data: null, error: err }
      return { data: { subjects: (s.data as SubjectRow[]).map(subj), topics: (t.data as TopicRow[]).map(topic) }, error: null }
    }),
    subjectUse: (id) => guard(async () => {
      const [t, q] = await Promise.all([
        sb.from('user_topics').select('id', { count: 'exact', head: true }).eq('subject_id', id),
        sb.from('user_questions').select('id', { count: 'exact', head: true }).eq('subject_id', id),
      ])
      const err = friendly(t.error) ?? friendly(q.error)
      return err ? { data: null, error: err } : { data: { topics: t.count ?? 0, questions: q.count ?? 0 }, error: null }
    }),
    topicUse: (id) => guard(async () => {
      const [t, q] = await Promise.all([
        sb.from('user_topics').select('id', { count: 'exact', head: true }).eq('parent_id', id),
        sb.from('user_question_topics').select('question_id', { count: 'exact', head: true }).eq('topic_id', id),
      ])
      const err = friendly(t.error) ?? friendly(q.error)
      return err ? { data: null, error: err } : { data: { topics: t.count ?? 0, questions: q.count ?? 0 }, error: null }
    }),
    createSubject: (name, description) => guard(async () => {
      const { data, error } = await sb.from('user_subjects').insert({ name, description }).select(SUBJ_COLS).single()
      return error ? { data: null, error: friendly(error) } : { data: subj(data as SubjectRow), error: null }
    }),
    updateSubject: (id, p) => guard(async () => {
      const patch: Record<string, unknown> = { ...archivedAt(p.archived) }
      if (p.name !== undefined) patch.name = p.name
      if (p.description !== undefined) patch.description = p.description
      const { data, error } = await sb.from('user_subjects').update(patch).eq('id', id).select(SUBJ_COLS).single()
      return error ? { data: null, error: friendly(error) } : { data: subj(data as SubjectRow), error: null }
    }),
    deleteSubject: (id) => guard(async () => {
      const { error } = await sb.from('user_subjects').delete().eq('id', id)
      return { data: null, error: friendly(error) }
    }),
    createTopic: (subjectId, parentId, name) => guard(async () => {
      const { data, error } = await sb.from('user_topics').insert({ subject_id: subjectId, parent_id: parentId, name }).select(TOPIC_COLS).single()
      return error ? { data: null, error: friendly(error) } : { data: topic(data as TopicRow), error: null }
    }),
    updateTopic: (id, p) => guard(async () => {
      const patch: Record<string, unknown> = { ...archivedAt(p.archived) }
      if (p.name !== undefined) patch.name = p.name
      if (p.parentId !== undefined) patch.parent_id = p.parentId
      const { data, error } = await sb.from('user_topics').update(patch).eq('id', id).select(TOPIC_COLS).single()
      return error ? { data: null, error: friendly(error) } : { data: topic(data as TopicRow), error: null }
    }),
    deleteTopic: (id) => guard(async () => {
      const { error } = await sb.from('user_topics').delete().eq('id', id)
      return { data: null, error: friendly(error) }
    }),
  }
}

export const WorkspaceRepoContext = createContext<WorkspaceRepo>(supabaseWorkspaceRepo())
export const useWorkspaceRepo = () => useContext(WorkspaceRepoContext)
