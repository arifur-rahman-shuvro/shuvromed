import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, DemoBanner, ErrorBox, ListSkeleton } from '../components/bits'
import { EmptyState } from '../components/ui'
import { useCatalog } from '../data/ContentContext'

export default function Subjects() {
  const cat = useCatalog()
  const [query, setQuery] = useState('')

  if (cat.status === 'loading') return <ListSkeleton rows={6} />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />

  const { taxonomy, manifest } = cat.catalog
  const counts = new Map(manifest.subjects.map((s) => [s.id, s.questionCount]))
  const q = query.trim().toLowerCase()
  const shown = taxonomy.subjects.filter((s) => s.name.toLowerCase().includes(q))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Subjects</h1>
      {manifest.includesDemo ? <DemoBanner /> : null}
      <div>
        <label htmlFor="subject-search" className="mb-1 block text-sm font-medium">
          Search subjects
        </label>
        <input
          id="subject-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Anatomy"
          className="min-h-12 w-full rounded-xl border border-line bg-surface px-4"
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No subjects match" body={`Nothing matches "${query}". Check the spelling or clear the search.`} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((s) => {
            const n = counts.get(s.id) ?? 0
            return (
              <li key={s.id}>
                <Link
                  to={`/app/subjects/${s.id}`}
                  className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface2"
                >
                  <span className="font-semibold">{s.name}</span>
                  {n > 0 ? <Badge>{n} {n === 1 ? 'question' : 'questions'}</Badge> : <span className="text-sm text-muted">No questions yet</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
