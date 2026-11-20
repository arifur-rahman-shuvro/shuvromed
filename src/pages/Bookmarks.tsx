import { useState, type FormEvent } from 'react'
import { ErrorBox, ListSkeleton } from '../components/bits'
import QuestionList from '../components/QuestionList'
import { Button, Card, EmptyState, LinkButton } from '../components/ui'
import { addCollection, deleteCollection, moveBookmark, toggleBookmark } from '../userdata/model'
import { updateUserData } from '../userdata/store'
import { configToParams, newSeed } from '../practice/params'
import { DEFAULT_CONFIG } from '../practice/session'
import { useStudyData } from './studyData'

export default function Bookmarks() {
  const { user, cat, qs, data, byId } = useStudyData()
  const [filter, setFilter] = useState<string>('all') // 'all' | 'none' | collection id
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!user) return null
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (cat.status !== 'ready' || qs.status !== 'ready') return <ListSkeleton rows={3} />

  const uid = user.id
  const report = (r: { ok: boolean; error?: string }) => setError(r.ok ? null : (r.error ?? 'Could not save.'))
  const shown = data.bookmarks.filter((b) => (filter === 'all' ? true : filter === 'none' ? b.collectionId === null : b.collectionId === filter))
  const items = shown.flatMap((b) => { const q = byId.get(b.questionId); return q ? [q] : [] })
  const missing = shown.length - items.length

  function create(e: FormEvent) {
    e.preventDefault()
    const r = updateUserData(uid, (d) => addCollection(d, name, crypto.randomUUID(), new Date().toISOString()))
    report(r)
    if (r.ok) setName('')
  }
  const practiceUrl = `/app/practice/play?${configToParams({ ...DEFAULT_CONFIG, mode: 'bookmarked', count: 20 }, newSeed()).toString()}`

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Saved learning</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Bookmarks</h1></div>

      <Card className="flex flex-col gap-4 border-line/90 p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold tracking-tight">Collections</h2>
        <form onSubmit={create} className="flex flex-wrap items-end gap-2" aria-label="New collection">
          <div className="min-w-0 flex-1">
            <label htmlFor="coll-name" className="mb-1 block text-sm font-medium">New collection name</label>
            <input id="coll-name" className="min-h-12 w-full rounded-xl border border-line bg-surface px-3" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary">Add collection</Button>
        </form>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show bookmarks from">
          {[['all', 'All'], ['none', 'Unfiled'], ...data.collections.map((c) => [c.id, c.name])].map(([id, text]) => (
            <Button key={id} variant={filter === id ? 'primary' : 'secondary'} aria-pressed={filter === id} onClick={() => setFilter(id)}>{text}</Button>
          ))}
        </div>
        {data.collections.some((c) => c.id === filter) ? (
          <Button variant="ghost" className="self-start" onClick={() => { report(updateUserData(uid, (d) => deleteCollection(d, filter))); setFilter('all') }}>
            Delete this collection (bookmarks are kept)
          </Button>
        ) : null}
      </Card>

      {error ? <p role="alert" className="text-danger">{error}</p> : null}

      {data.bookmarks.length === 0 ? (
        <EmptyState title="No bookmarks yet" body="Tap Bookmark under any question to save it here." action={<LinkButton to="/app/subjects">Browse subjects</LinkButton>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton to={practiceUrl}>Practise my bookmarks</LinkButton>
            <p className="text-sm text-muted">{data.bookmarks.length} bookmarked</p>
          </div>
          {missing > 0 ? <p className="text-sm text-muted">{missing} bookmarked {missing === 1 ? 'question is' : 'questions are'} not in the current question bank and cannot be shown.</p> : null}
          {shown.length === 0 ? <p className="text-muted">No bookmarks in this view.</p> : null}
          {items.length > 0 ? <QuestionList items={items} topics={cat.catalog.taxonomy.topics} label="Bookmarked questions" extra={(q) => (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`move-${q.id}`}>Collection for this question</label>
              <select id={`move-${q.id}`} className="min-h-12 rounded-xl border border-line bg-surface px-3"
                value={data.bookmarks.find((b) => b.questionId === q.id)?.collectionId ?? ''}
                onChange={(e) => report(updateUserData(uid, (d) => moveBookmark(d, q.id, e.target.value || null)))}>
                <option value="">Unfiled</option>
                {data.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="ghost" aria-label={`Remove bookmark: ${q.stem.slice(0, 40)}`} onClick={() => report(updateUserData(uid, (d) => toggleBookmark(d, q.id, new Date().toISOString())))}>Remove</Button>
            </div>
          )} /> : null}
        </>
      )}
    </div>
  )
}
