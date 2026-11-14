import { ErrorBox, ListSkeleton, pctText } from '../components/bits'
import QuestionList from '../components/QuestionList'
import { Card, EmptyState, LinkButton } from '../components/ui'
import { configToParams, newSeed } from '../practice/params'
import { DEFAULT_CONFIG } from '../practice/session'
import { noteFor } from '../userdata/model'
import { useStudyData } from './studyData'

/** Questions the student last got wrong, with their own notes; plus every note they have written. */
export default function Notebook() {
  const { user, cat, qs, data, latest, attempts, byId } = useStudyData()
  if (!user) return null
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || qs.status !== 'ready') return <ListSkeleton rows={3} />

  const wrongIds = [...latest.values()].filter((a) => !a.isCorrect).sort((a, b) => (a.attemptedAt < b.attemptedAt ? 1 : -1)).map((a) => a.questionId)
  const wrong = wrongIds.flatMap((id) => { const q = byId.get(id); return q ? [q] : [] })
  const noted = data.notes.flatMap((n) => { const q = byId.get(n.questionId); return q ? [q] : [] })
  const timesWrong = (id: string) => attempts.filter((a) => a.questionId === id && !a.isCorrect).length
  const timesSeen = (id: string) => attempts.filter((a) => a.questionId === id).length
  const practiceUrl = `/app/practice/play?${configToParams({ ...DEFAULT_CONFIG, mode: 'incorrect', count: 20 }, newSeed()).toString()}`

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Personal knowledge</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Notebook</h1></div>

      <section aria-label="Incorrect questions" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Questions I got wrong</h2>
        {wrong.length === 0 ? (
          <EmptyState title="Nothing here" body="Questions whose latest answer was wrong collect here until you get them right." action={<LinkButton to="/app/practice">Start practice</LinkButton>} />
        ) : (
          <>
            <LinkButton to={practiceUrl} className="self-start">Practise these questions</LinkButton>
            <QuestionList items={wrong} topics={cat.catalog.taxonomy.topics} label="Incorrect questions" extra={(q) => (
              <>
                <p className="text-sm text-muted">Wrong {timesWrong(q.id)} of {timesSeen(q.id)} {timesSeen(q.id) === 1 ? 'time' : 'times'} ({pctText(100 * (1 - timesWrong(q.id) / timesSeen(q.id)))} right)</p>
                {noteFor(data, q.id) ? <p className="whitespace-pre-line rounded-xl bg-surface2 p-3 text-sm">{noteFor(data, q.id)?.body}</p> : null}
              </>
            )} />
          </>
        )}
      </section>

      <section aria-label="My notes" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">My notes</h2>
        {noted.length === 0 ? (
          <Card><p className="text-muted">Notes you write under a question appear here.</p></Card>
        ) : (
          <QuestionList items={noted} topics={cat.catalog.taxonomy.topics} label="Questions with notes" extra={(q) => <p className="whitespace-pre-line rounded-xl bg-surface2 p-3 text-sm">{noteFor(data, q.id)?.body}</p>} />
        )}
      </section>
    </div>
  )
}
