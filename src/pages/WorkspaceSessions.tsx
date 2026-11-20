import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { useSessionRepo, type WSession } from '../session/repo'
import { formatDuration } from '../session/score'
import { describeConfig } from '../session/start'
import { useWorkspaceEnabled } from '../workspace/flag'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const small = 'min-h-10 rounded-lg px-3 text-xs font-semibold text-muted transition-colors hover:bg-surface2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand'
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

/** Past and unfinished sessions: carry on, review, or hide from the list (hiding never deletes the answers). */
export default function WorkspaceSessions() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [list, setList] = useState<WSession[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hidden, setHidden] = useState(false)

  const load = useCallback(async () => {
    const r = await sessions.list({ includeHidden: hidden })
    if (r.error || !r.data) { setStatus('error'); return }
    setList(r.data); setStatus('ready')
  }, [sessions, hidden])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])
  if (!enabled) return <Navigate to="/app/settings" replace />

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Practice history</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Past sessions</h1></div>
        <Link className="underline" to="/app/workspace/practice">New session</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Include hidden sessions</label>
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your sessions.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}
      {status === 'ready' && list.length === 0 ? <EmptyState title="No sessions yet" body="Start a practice run or an exam from Practice and exams." /> : null}
      <ul className="flex flex-col gap-2">
        {list.map((s) => (
          <li key={s.id}>
            <Card>
              <p className={s.hidden ? 'text-muted' : 'font-medium'}>{s.title}{s.hidden ? ' (hidden)' : ''}</p>
              <p className="text-sm text-muted">{when(s.startedAt)} · {describeConfig(s.config)}</p>
              <p className="text-sm">
                {s.status === 'in_progress' ? 'Not finished' : s.status === 'abandoned' ? 'Stopped' : s.result ? `Score ${s.result.score} of ${s.result.max} · ${formatDuration(s.elapsedMs)}` : 'Finished'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.status === 'in_progress'
                  ? <Link className={`${small} inline-flex items-center`} aria-label={`Continue: ${s.title}`} to={`/app/workspace/session/${s.id}`}>Continue</Link>
                  : <Link className={`${small} inline-flex items-center`} aria-label={`Review: ${s.title}`} to={`/app/workspace/session/${s.id}/result`}>Review</Link>}
                <button type="button" className={small} aria-label={`${s.hidden ? 'Show' : 'Hide'}: ${s.title}`} onClick={() => void sessions.setHidden(s.id, !s.hidden).then(load)}>{s.hidden ? 'Show' : 'Hide'}</button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
