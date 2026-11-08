import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, LinkButton, Skeleton } from '../components/ui'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { stemPreview, TYPE_INFO } from '../questions/registry'
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
  const sync = useWorkspaceSync()
  const location = useLocation()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [subjectFilter, setSubjectFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [notice, setNotice] = useState<{ text: string; undo?: () => void; error?: boolean } | null>((location.state as { notice?: string } | null)?.notice ? { text: (location.state as { notice: string }).notice } : null)

  const load = useCallback(async () => {
    const [w, q] = await Promise.all([ws.load(), qr.list()])
    if (w.error || !w.data || q.error || !q.data) { setStatus('error'); return }
    setSubjects(w.data.subjects)
    setQuestions(q.data)
    setStatus('ready')
  }, [ws, qr])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  const subjectName = useCallback((id: string) => subjects.find((s) => s.id === id)?.name ?? 'Unknown subject', [subjects])
  const shown = useMemo(
    () => questions.filter((q) => (showArchived || !q.archived) && (!subjectFilter || q.subjectId === subjectFilter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [questions, showArchived, subjectFilter],
  )

  if (!enabled) return <Navigate to="/app/settings" replace />

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
        <LinkButton to="/app/workspace/questions/new">Add question</LinkButton>
      </div>
      <p className="text-muted">Your own questions, private to you. <Link className="underline" to="/app/workspace/subjects">Manage subjects and topics</Link></p>
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
                <p className={q.archived ? 'text-muted' : ''}>{stemPreview(q.stem, 160)}</p>
                <p className="mt-1 text-sm text-muted">
                  {TYPE_INFO[q.type].label} · {subjectName(q.subjectId)}{q.topicIds.length ? ` · ${plural(q.topicIds.length, 'topic')}` : ''}{q.difficulty ? ` · ${q.difficulty}` : ''}{q.archived ? ' · archived' : ''}
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
