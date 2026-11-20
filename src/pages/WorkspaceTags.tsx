import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { plural } from '../workspace/model'
import { useTagRepo, type TagCategory, type WTag } from '../tags/repo'
import { useWorkspaceEnabled } from '../workspace/flag'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const small = 'min-h-10 rounded-lg px-3 text-xs font-semibold text-muted transition-colors hover:bg-surface2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand'
const input = 'min-h-12 w-full rounded-xl border border-line bg-bg px-4 text-sm text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10'
const GROUPS: { category: TagCategory; title: string; hint: string }[] = [
  { category: 'exam', title: 'Exam tags', hint: 'A question with at least one exam tag belongs to those exams only. A question with none is Universal and is available to every exam.' },
  { category: 'general', title: 'General tags', hint: 'Your own labels, such as high yield or revise again. They never change whether a question is Universal.' },
]

/** Create, rename, archive and delete tags. Hidden behind the workspace switch until the cutover. */
export default function WorkspaceTags() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const repo = useTagRepo()
  const sync = useWorkspaceSync()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tags, setTags] = useState<WTag[]>([])
  const [adding, setAdding] = useState<TagCategory | null>(null)
  const [addName, setAddName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await repo.list()
    if (r.error || !r.data) { setStatus('error'); return }
    setTags(r.data)
    setStatus('ready')
  }, [repo])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  if (!enabled) return <Navigate to="/app/settings" replace />

  async function run<T>(p: Promise<{ data: T | null; error: string | null }>, done: string, after?: () => void) {
    setError(null)
    const r = await p
    if (r.error) { setError(r.error); return }
    setNotice(done)
    after?.()
    await load()
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Question organization</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My tags</h1></div>
        <Link className="underline" to="/app/workspace/questions">My questions</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      <div role="status" aria-live="polite">{notice ? <p className="text-muted">{notice}</p> : null}</div>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-20 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your tags.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}
      {status === 'ready' ? GROUPS.map((g) => {
        const list = tags.filter((t) => t.category === g.category)
        return (
          <section key={g.category} aria-label={g.title} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold tracking-tight">{g.title}</h2>
            <p className="text-sm text-muted">{g.hint}</p>
            {list.length === 0 ? <EmptyState title={`No ${g.category} tags yet`} body="Add one below." /> : (
              <ul className="flex flex-col gap-2">
                {list.map((t) => (
                  <li key={t.id}>
                    <Card>
                      {renaming === t.id ? (
                        <form className="flex flex-col gap-2" aria-label={`Rename ${t.name}`} onSubmit={(e) => { e.preventDefault(); void run(repo.rename(t.id, renameName), 'Tag renamed.', () => setRenaming(null)) }}>
                          <label className="flex flex-col gap-1 text-sm font-medium">New name
                            <input className={input} value={renameName} maxLength={80} onChange={(e) => setRenameName(e.target.value)} />
                          </label>
                          <div className="flex gap-2"><Button type="submit">Save name</Button><Button type="button" variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button></div>
                        </form>
                      ) : (
                        <>
                          <p className={t.archived ? 'text-muted' : 'font-medium'}>{t.name}{t.archived ? ' (archived)' : ''}</p>
                          <p className="text-sm text-muted">{plural(t.uses, 'question')}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <button type="button" className={small} aria-label={`Rename: ${t.name}`} onClick={() => { setRenaming(t.id); setRenameName(t.name); setError(null) }}>Rename</button>
                            <button type="button" className={small} aria-label={`${t.archived ? 'Restore' : 'Archive'}: ${t.name}`} onClick={() => void run(repo.setArchived(t.id, !t.archived), t.archived ? 'Tag restored.' : 'Tag archived. Questions keep it.')}>{t.archived ? 'Restore' : 'Archive'}</button>
                            <button type="button" className={small} aria-label={`Delete: ${t.name}`} onClick={() => { setDeleting(t.id); setError(null) }}>Delete</button>
                          </div>
                          {deleting === t.id ? (
                            <div className="mt-2 rounded-xl border border-line bg-surface2 p-3" role="group" aria-label={`Confirm delete ${t.name}`}>
                              <p className="text-sm">Delete this tag? It is taken off {plural(t.uses, 'question')}. The questions are kept{t.category === 'exam' ? '; a question with no other exam tag becomes Universal' : ''}.</p>
                              <div className="mt-2 flex gap-2">
                                <Button onClick={() => void run(repo.remove(t.id), 'Tag deleted.', () => setDeleting(null))}>Delete tag</Button>
                                <Button variant="secondary" onClick={() => setDeleting(null)}>Keep it</Button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {adding === g.category ? (
              <form className="flex flex-col gap-2" aria-label={`Add ${g.category} tag`} onSubmit={(e) => { e.preventDefault(); void run(repo.create(g.category, addName), 'Tag added.', () => { setAdding(null); setAddName('') }) }}>
                <label className="flex flex-col gap-1 text-sm font-medium">Tag name
                  <input className={input} value={addName} maxLength={80} onChange={(e) => setAddName(e.target.value)} />
                </label>
                <div className="flex gap-2"><Button type="submit">Add tag</Button><Button type="button" variant="secondary" onClick={() => setAdding(null)}>Cancel</Button></div>
              </form>
            ) : <div><Button variant="secondary" onClick={() => { setAdding(g.category); setAddName(''); setError(null) }}>{g.category === 'exam' ? 'Add exam tag' : 'Add general tag'}</Button></div>}
          </section>
        )
      }) : null}
    </div>
  )
}
