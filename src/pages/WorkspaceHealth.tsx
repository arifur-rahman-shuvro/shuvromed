import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Skeleton } from '../components/ui'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { useSessionRepo, type WAttempt, type WSession } from '../session/repo'
import { useTagRepo } from '../tags/repo'
import { checkHealth, formatBytes, readStorage, type Finding, type StorageInfo } from '../workspace/health'
import { plural, type WSubject, type WTopic } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

/** How much space the app uses on this device, how much is waiting to sync, and a read-only check of the data. */
export default function WorkspaceHealth() {
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [findings, setFindings] = useState<Finding[]>([])
  const [counts, setCounts] = useState<{ subjects: number; topics: number; questions: number; tags: number; sessions: number; answers: number } | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const run = useCallback(async () => {
    setStatus('loading')
    const [w, q, t, s, a, st] = await Promise.all([ws.load(), qr.list(), tagRepo.list(), sessions.list({ includeHidden: true }), sessions.allAttempts(), readStorage()])
    if (w.error || !w.data || q.error || !q.data || t.error || !t.data) { setStatus('error'); return }
    const subjects: WSubject[] = w.data.subjects, topics: WTopic[] = w.data.topics, questions: WQuestion[] = q.data
    const ses: WSession[] = s.data ?? [], att: WAttempt[] = a.data ?? []
    const now = new Date()
    setFindings(checkHealth({ subjects, topics, tags: t.data, questions, sessions: ses, attempts: att, now }))
    setCounts({ subjects: subjects.length, topics: topics.length, questions: questions.length, tags: t.data.length, sessions: ses.length, answers: att.length })
    setStorage(st); setCheckedAt(now); setStatus('ready')
  }, [ws, qr, tagRepo, sessions])
  useEffect(() => { void run() }, [run, dataVersion])

  const snap = sync?.snapshot
  const problems = findings.filter((f) => f.severity === 'problem')
  const notes = findings.filter((f) => f.severity === 'note')
  const pct = storage?.usedBytes != null && storage.quotaBytes ? Math.min(100, Math.round((storage.usedBytes / storage.quotaBytes) * 1000) / 10) : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Data health</h1>
        <Link className="underline" to="/app/settings">Settings</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-24 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not read your data.</p><Button className="mt-3" variant="secondary" onClick={() => void run()}>Try again</Button></Card> : null}

      {status === 'ready' && counts ? (
        <>
          <section aria-label="Storage" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Storage on this device</h2>
            {storage?.usedBytes != null ? (
              <>
                <p>The app uses {formatBytes(storage.usedBytes)}{storage.quotaBytes ? ` of about ${formatBytes(storage.quotaBytes)} this browser allows${pct !== null ? ` (${pct}%)` : ''}` : ''}.</p>
                {pct !== null ? <div role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-3 overflow-hidden rounded-full bg-surface2"><div className="h-full bg-brand" style={{ width: `${Math.max(1, pct)}%` }} /></div> : null}
              </>
            ) : <p className="text-sm text-muted">This browser cannot tell how much space is used.</p>}
            {storage?.persistent === false ? <p className="text-sm text-muted">The browser may clear this data if the phone runs low on space. Anything not yet synced would be lost, so keep Sync now up to date.</p> : null}
            {storage?.persistent === true ? <p className="text-sm text-muted">The browser will keep this data unless you clear it.</p> : null}
            <p className="text-sm text-muted">{plural(counts.questions, 'question')}, {plural(counts.subjects, 'subject')}, {plural(counts.topics, 'topic')}, {plural(counts.tags, 'tag')}, {plural(counts.sessions, 'session')}, {plural(counts.answers, 'saved answer')}.</p>
          </section>

          <section aria-label="Sync" className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Sync</h2>
            <p>{snap && snap.pending > 0 ? `${plural(snap.pending, 'change')} waiting to be sent.` : 'Nothing is waiting to be sent.'}</p>
            {snap && snap.rejected.length > 0 ? <p role="alert" className="text-danger">{plural(snap.rejected.length, 'change')} refused by the server. Use Discard on the bar above to clear them.</p> : null}
            <p className="text-sm text-muted">{snap?.lastSyncAt ? `Last synced ${new Date(snap.lastSyncAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not synced yet on this device.'}</p>
          </section>

          <section aria-label="Data check" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Data check</h2>
            {findings.length === 0 ? <p>No problems found.</p> : null}
            {problems.length > 0 ? <p role="alert" className="text-danger">{plural(problems.length, 'problem')} found.</p> : null}
            <ul className="flex flex-col gap-2">
              {[...problems, ...notes].map((f) => (
                <li key={f.id}>
                  <Card>
                    <p className="font-medium">{f.title}: {f.count}</p>
                    <p className="text-sm">{f.advice}</p>
                    {f.examples.length ? <p className="text-sm text-muted">For example: {f.examples.join('; ')}</p> : null}
                    {f.to ? <Link className="mt-1 inline-flex min-h-11 items-center underline" to={f.to}>Open</Link> : null}
                  </Card>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3"><Button variant="secondary" onClick={() => void run()}>Check again</Button>{checkedAt ? <span className="text-sm text-muted">Checked {checkedAt.toLocaleTimeString('en-GB', { timeStyle: 'short' })}. This check only reads your data and never changes it.</span> : null}</div>
          </section>
        </>
      ) : null}
    </div>
  )
}
