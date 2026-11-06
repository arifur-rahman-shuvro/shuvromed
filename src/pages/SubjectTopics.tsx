import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Badge, DemoBanner, ErrorBox, ListSkeleton, pctText } from '../components/bits'
import { EmptyState, LinkButton } from '../components/ui'
import { buildTopicTree, descendantIds, type TopicNode } from '../content/tree'
import type { Question, Topic } from '../content/schema'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { useAttempts, type Attempt } from '../practice/attempts'
import { topicStats } from '../practice/stats'

function TopicRow({
  node, topics, questions, attempts, styleName, subjectId,
}: {
  node: TopicNode
  topics: Topic[]
  questions: Question[]
  attempts: Attempt[]
  styleName: (id: string) => string
  subjectId: string
}) {
  const ids = descendantIds(topics, node.topic.id)
  const stats = topicStats(questions.filter((q) => ids.has(q.topicId)), attempts)
  const can = stats.questionCount > 0
  const headingId = `topic-${node.topic.id}`
  return (
    <li>
      <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id={headingId} className="font-semibold">{node.topic.name}</h3>
            <p className="text-sm text-muted">
              {stats.questionCount} {stats.questionCount === 1 ? 'question' : 'questions'}
              {' · '}Attempted {stats.attemptedQuestions}/{stats.questionCount}
              {' · '}Accuracy {pctText(stats.accuracyPct)}
              {' · '}Mastery {pctText(stats.masteryPct)}
            </p>
          </div>
          {can ? (
            <LinkButton to={`/app/practice?subject=${subjectId}&topic=${node.topic.id}`} aria-label={`Start practice: ${node.topic.name}`}>
              Start practice
            </LinkButton>
          ) : (
            <span className="text-sm text-muted">No questions yet</span>
          )}
        </div>
        {can ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Difficulty:</span>
            <Badge>Easy {stats.difficultyMix.easy}</Badge>
            <Badge>Medium {stats.difficultyMix.medium}</Badge>
            <Badge>Hard {stats.difficultyMix.hard}</Badge>
            <span className="ml-2 text-muted">Styles:</span>
            {stats.examStyles.map((s) => <Badge key={s}>{styleName(s)}</Badge>)}
          </div>
        ) : null}
        {node.children.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-3">
            {node.children.map((c) => (
              <TopicRow key={c.topic.id} node={c} topics={topics} questions={questions} attempts={attempts} styleName={styleName} subjectId={subjectId} />
            ))}
          </ul>
        ) : null}
      </section>
    </li>
  )
}

export default function SubjectTopics() {
  const { subjectId = '' } = useParams()
  const cat = useCatalog()
  const qs = useQuestions([subjectId])
  const { user } = useAuth()
  const attempts = useAttempts(user?.id)

  if (cat.status === 'loading' || (cat.status === 'ready' && qs.status === 'loading')) return <ListSkeleton rows={4} />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />

  const { taxonomy, manifest } = cat.catalog
  const subject = taxonomy.subjects.find((s) => s.id === subjectId)
  if (!subject) {
    return (
      <EmptyState
        title="Subject not found"
        body="That subject does not exist or is not active."
        action={<LinkButton to="/app/subjects">Back to subjects</LinkButton>}
      />
    )
  }

  const questions = qs.status === 'ready' ? qs.questions : []
  const tree = buildTopicTree(taxonomy.topics, subjectId)
  const styleName = (id: string) => taxonomy.examStyles.find((e) => e.id === id)?.name ?? id

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/app/subjects" className="underline">Subjects</Link> / {subject.name}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{subject.name}</h1>
        {questions.length > 0 ? <LinkButton to={`/app/practice?subject=${subjectId}`} variant="secondary">Practise whole subject</LinkButton> : null}
      </div>
      {manifest.includesDemo && questions.some((q) => q.isDemo) ? <DemoBanner /> : null}
      {tree.length === 0 ? (
        <EmptyState title="No topics yet" body="Topics for this subject have not been added. New topics are added through data files, with no app update needed." />
      ) : (
        <ul className="flex flex-col gap-3">
          {tree.map((n) => (
            <TopicRow key={n.topic.id} node={n} topics={taxonomy.topics} questions={questions} attempts={attempts} styleName={styleName} subjectId={subjectId} />
          ))}
        </ul>
      )}
    </div>
  )
}
