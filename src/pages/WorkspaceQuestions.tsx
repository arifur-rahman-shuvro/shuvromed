import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, LinkButton, Skeleton } from '../components/ui'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { stemPreview, TYPE_INFO } from '../questions/registry'
import { isUniversal, useTagRepo, type WTag } from '../tags/repo'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural, type WSubject } from '../workspace/model'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'
import { useWorkspaceRepo } from '../workspace/repo'

const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'

/** A plain list of the owner's questions. The full bank with search and filters arrives in Phase 7. */
export default function WorkspaceQuestions() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const sync = useWorkspaceSync()
  const location = useLocation()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [tags, setTags] = useState<WTag[]>([])
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkTag, setBulkTag] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState<{ text: string; undo?: () => void; error?: boolean } | null>((location.state as { notice?: string } | null)?.notice ? { text: (location.state as { notice: string }).notice } : null)

  const load = useCallback(async () => {
    const [w, q, tg] = await Promise.all([ws.load(), qr.list(), tagRepo.list()])
    if (w.error || !w.data || q.error || !q.data || tg.error || !tg.data) { setStatus('error'); return }
    setSubjects(w.data.subjects)
    setTags(tg.data)
    setQuestions(q.data)
    setStatus('ready')
  }, [ws, qr, tagRepo])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  const subjectName = useCallback((id: string) => subjects.find((s) => s.id === id)?.name ?? 'Unknown subject', [subjects])
  const shown = useMemo(
    () => questions.filter((q) => (showArchived || !q.archived) && (!subjectFilter || q.subjectId === subjectFilter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [questions, showArchived, subjectFilter],
  )

  if (!enabled) return <Navigate to="/app/settings" replace />

  const shownIds = shown.map((q) => q.id)
  const pickedShown = shownIds.filter((id) => picked.has(id))
  const activeTags = tags.filter((t) => !t.archived)
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? ''
  function togglePick(id: string, on: boolean) {
    setPicked((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n })
  }
  async function bulk(mode: 'add' | 'remove') {
    if (!bulkTag) return setNotice({ text: 'Choose a tag first.', error: true })
    const r = await qr.bulkTags(pickedShown, mode === 'add' ? { add: [bulkTag] } : { remove: [bulkTag] })
    if (r.error || !r.data) return setNotice({ text: r.error ?? 'Could not change the tags.', error: true })
    const undoChange = mode === 'add' ? { remove: [bulkTag] } : { add: [bulkTag] }
    const ids = pickedShown
    const n = r.data.changed
    setNotice({
      text: `${mode === 'add' ? 'Added' : 'Removed'} "${tagName(bulkTag)}" ${mode === 'add' ? 'to' : 'from'} ${plural(n, 'question')}.`,
      undo: n ? () => { void qr.bulkTags(ids, undoChange).then(load).then(() => setNotice({ text: 'Undone.' })) } : undefined,
    })
    await load()
  }
  async function toggleArchive(q: WQuestion) {
    const r = await qr.setArchived(q.id, !q.archived)
    if (r.error) return setNotice({ text: r.error, error: true })
    setNotice({ text: q.archived ? 'Restored.' : 'Archived. It is hidden but nothing was deleted.' })
    await load()
  }
  async function remove(q: WQuestion) {
    const r = await qr.setDeleted(q.id, true)
    if (r.error) return setNotice({ text: r.error, error: true })
    setNotice({ text: 'Question deleted. Its history is kept.', undo: () => { void qr.setDeleted(q.id, false).then(load).then(() => setNotice({ text: 'Question restored.' })) } })
    await load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">My questions</h1>
        <Button variant="secondary" onClick={() => { setSelecting((v) => !v); setPicked(new Set()) }}>{selecting ? 'Done selecting' : 'Select'}</Button>
        <LinkButton to="/app/workspace/questions/new">Add question</LinkButton>
      </div>
      <p className="text-muted">Your own questions, private to you. <Link className="underline" to="/app/workspace/subjects">Manage subjects and topics</Link> · <Link className="underline" to="/app/workspace/tags">Manage tags</Link> · <Link className="underline" to="/app/workspace/import">Import / export</Link></p>
      {sync ? <SyncBar sync={sync} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Subject
          <select className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
            <option value="">All subjects</option>
            {[...subjects].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
      </div>

      {selecting ? (
        <Card>
          <div role="group" aria-label="Bulk tags" className="flex flex-col gap-2">
            <p className="text-sm font-medium">{plural(pickedShown.length, 'question')} selected</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPicked(new Set(shownIds))}>Select all shown</Button>
              <Button variant="secondary" onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">Tag
              <select className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}>
                <option value="">Choose a tag…</option>
                {activeTags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button disabled={pickedShown.length === 0} onClick={() => void bulk('add')}>Add tag</Button>
              <Button variant="secondary" disabled={pickedShown.length === 0} onClick={() => void bulk('remove')}>Remove tag</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div role="status" aria-live="polite">
        {notice ? (
          <p className={notice.error ? 'text-danger' : 'text-muted'} role={notice.error ? 'alert' : undefined}>
            {notice.text} {notice.undo ? <button type="button" className="ml-1 min-h-11 font-medium underline" onClick={notice.undo}>Undo</button> : null}
          </p>
        ) : null}
      </div>

      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-20 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your questions.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}
      {status === 'ready' && shown.length === 0 ? (
        <EmptyState title={questions.length === 0 ? 'No questions yet' : 'No questions match'} body={questions.length === 0 ? 'Press Add question to write your first one. You need at least one subject.' : 'Change the subject filter or show archived questions.'} />
      ) : null}
      {status === 'ready' ? (
        <ul className="flex flex-col gap-3">
          {shown.map((q) => (
            <li key={q.id}>
              <Card>
                {selecting ? <label className="mb-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={picked.has(q.id)} onChange={(e) => togglePick(q.id, e.target.checked)} aria-label={`Select: ${stemPreview(q.stem, 40)}`} /> Select</label> : null}
                <p className={q.archived ? 'text-muted' : ''}>{stemPreview(q.stem, 160)}</p>
                <p className="mt-1 text-sm text-muted">
                  {TYPE_INFO[q.type].label} · {subjectName(q.subjectId)}{q.topicIds.length ? ` · ${plural(q.topicIds.length, 'topic')}` : ''}{q.difficulty ? ` · ${q.difficulty}` : ''}{q.archived ? ' · archived' : ''}
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-xs">
                  {isUniversal(q.tagIds, tags) ? <span className="rounded-full border border-line px-2 py-0.5">Universal</span> : null}
                  {q.tagIds.filter((id) => tagName(id)).map((id) => <span key={id} className="rounded-full bg-surface2 px-2 py-0.5">{tagName(id)}</span>)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Link className={small + ' inline-flex items-center border border-line'} to={`/app/workspace/questions/${q.id}`} aria-label={`Edit: ${stemPreview(q.stem, 40)}`}>Edit</Link>
                  <button type="button" className={small} onClick={() => void toggleArchive(q)} aria-label={`${q.archived ? 'Restore' : 'Archive'}: ${stemPreview(q.stem, 40)}`}>{q.archived ? 'Restore' : 'Archive'}</button>
                  <button type="button" className={small} onClick={() => void remove(q)} aria-label={`Delete: ${stemPreview(q.stem, 40)}`}>Delete</button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
