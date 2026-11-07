import type { ReactNode } from 'react'
import type { Question, Topic } from '../content/schema'
import { Badge } from './bits'
import { Card } from './ui'

const shorten = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

/** A compact list of questions for the saved/revision pages. `extra` renders per-row details and actions. */
export default function QuestionList({
  items, topics, label, extra,
}: {
  items: Question[]
  topics: readonly Topic[]
  label: string
  extra?: (q: Question) => ReactNode
}) {
  const topicName = (id: string) => topics.find((t) => t.id === id)?.name ?? id
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((q) => (
        <li key={q.id}>
          <Card className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {q.isDemo ? <Badge tone="demo">DEMO</Badge> : null}
              <Badge>{topicName(q.topicId)}</Badge>
              <Badge>{q.difficulty}</Badge>
            </div>
            <p>{shorten(q.stem)}</p>
            {extra ? extra(q) : null}
          </Card>
        </li>
      ))}
    </ul>
  )
}
