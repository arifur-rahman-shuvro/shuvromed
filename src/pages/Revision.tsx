import { dayCount } from '../lib/days'
import { ErrorBox, ListSkeleton } from '../components/bits'
import QuestionList from '../components/QuestionList'
import { EmptyState, LinkButton, Stat } from '../components/ui'
import { configToParams, newSeed } from '../practice/params'
import { DEFAULT_CONFIG } from '../practice/session'
import { dueQuestions, useStudyData } from './studyData'

export default function Revision() {
  const { user, cat, qs, schedule, byId } = useStudyData()
  if (!user) return null
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || qs.status !== 'ready') return <ListSkeleton rows={3} />

  const due = dueQuestions(schedule)
  const dueQs = due.flatMap((d) => { const q = byId.get(d.questionId); return q ? [q] : [] })
  const upcoming = schedule.size - due.length
  const practiceUrl = `/app/practice/play?${configToParams({ ...DEFAULT_CONFIG, mode: 'due', count: 20 }, newSeed()).toString()}`

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Revision</h1>
      <p className="text-muted">Questions come back at growing gaps. A wrong answer brings a question back tomorrow; right answers push it further out.</p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Due now" value={String(due.length)} />
        <Stat label="Scheduled later" value={String(upcoming)} />
      </div>
      {dueQs.length === 0 ? (
        <EmptyState title="Nothing due" body={schedule.size === 0 ? 'Answer some questions and they will be scheduled for revision automatically.' : 'You are up to date. Come back when more questions are due.'} action={<LinkButton to="/app/practice">Start practice</LinkButton>} />
      ) : (
        <>
          <LinkButton to={practiceUrl} className="self-start">Start revision ({Math.min(20, dueQs.length)} questions)</LinkButton>
          <QuestionList items={dueQs} topics={cat.catalog.taxonomy.topics} label="Questions due for revision" extra={(q) => {
            const s = schedule.get(q.id)
            return s ? <p className="text-sm text-muted">Due since {s.dueAt.slice(0, 10)} · interval {dayCount(s.intervalDays)} · lapses {s.lapses}</p> : null
          }} />
        </>
      )}
    </div>
  )
}
