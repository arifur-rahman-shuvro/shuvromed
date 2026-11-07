import { useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { Question } from '../content/schema'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { latestAttempts } from '../practice/session'
import { useAttempts } from '../practice/attempts'
import { buildSchedule, dueQuestions } from '../practice/srs'
import { useUserData } from '../userdata/store'

/** Everything the saved/revision pages need, derived from attempts and the user's saved data. */
export function useStudyData() {
  const { user } = useAuth()
  const cat = useCatalog()
  const qs = useQuestions(null)
  const attempts = useAttempts(user?.id)
  const data = useUserData(user?.id)
  const schedule = useMemo(() => buildSchedule(attempts), [attempts])
  const latest = useMemo(() => latestAttempts(attempts), [attempts])
  const byId = useMemo(() => new Map<string, Question>(qs.status === 'ready' ? qs.questions.map((q) => [q.id, q]) : []), [qs])
  return { user, cat, qs, attempts, data, schedule, latest, byId }
}

export { dueQuestions }
