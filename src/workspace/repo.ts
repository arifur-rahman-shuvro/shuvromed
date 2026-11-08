import { createContext, useContext } from 'react'
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

const unavailable = <T,>(): Promise<Result<T>> => Promise.resolve({ data: null, error: 'Your workspace is not ready yet.' })
const notReady: WorkspaceRepo = {
  load: () => unavailable(), subjectUse: () => unavailable(), topicUse: () => unavailable(), createSubject: () => unavailable(), updateSubject: () => unavailable(),
  deleteSubject: () => unavailable(), createTopic: () => unavailable(), updateTopic: () => unavailable(), deleteTopic: () => unavailable(),
}

/** Screens never talk to the server. They use the on-device repo that WorkspaceProvider supplies (tests supply a fake). */
export const WorkspaceRepoContext = createContext<WorkspaceRepo | null>(null)
export const useWorkspaceRepo = (): WorkspaceRepo => useContext(WorkspaceRepoContext) ?? notReady
