import { useCallback, useEffect, useState } from 'react'
import { useServerClients, type BackupRun, type FlagRow } from '../account/clients'
import { ErrorBox, ListSkeleton } from '../components/bits'
import { Button, Card, EmptyState } from '../components/ui'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const size = (n: number | null) => (n === null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

type State = { status: 'loading' } | { status: 'denied' } | { status: 'error'; error: string } | { status: 'ready'; flags: FlagRow[]; backups: BackupRun[]; backupError: string | null }

/**
 * Owner-only tools. Showing this page is a convenience: every rule is enforced by the database, so a
 * non-admin who opens the address sees nothing (their requests are refused by row level security).
 */
export default function Admin() {
  const { admin } = useServerClients()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!admin) return setState({ status: 'denied' })
    if (!(await admin.isAdmin())) return setState({ status: 'denied' })
    const [f, b] = await Promise.all([admin.listFlags(), admin.listBackups()])
    if (f.error) return setState({ status: 'error', error: f.error })
    setState({ status: 'ready', flags: f.rows, backups: b.rows, backupError: b.error })
  }, [admin])

  useEffect(() => {
    let live = true
    void (async () => { if (live) await load() })()
    return () => { live = false }
  }, [load])

  if (state.status === 'loading') return <ListSkeleton rows={3} />
  if (state.status === 'denied') return <EmptyState title="No access" body="This area is only for the ShuvroMed owner." />
  if (state.status === 'error') return <ErrorBox message={state.error} onRetry={() => void load()} />

  const toggle = async (f: FlagRow) => {
    if (!admin) return
    setBusyId(f.id); setNote(null)
    const r = await admin.setFlagStatus(f.id, f.status === 'open' ? 'resolved' : 'open')
    setBusyId(null)
    if (r.error) return setNote(`Could not update the report: ${r.error}`)
    await load()
  }
  const open = state.flags.filter((f) => f.status === 'open')
  const resolved = state.flags.filter((f) => f.status === 'resolved')

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Admin</h1>
      {note ? <p role="alert" className="rounded-xl border border-danger p-3 text-danger">{note}</p> : null}

      <section aria-label="Question reports" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Question reports ({open.length} open)</h2>
        {state.flags.length === 0 ? <Card><p>No reports yet.</p></Card> : (
          <ul className="flex flex-col gap-3">
            {[...open, ...resolved].map((f) => (
              <li key={f.id}>
                <Card className="flex flex-col gap-2">
                  <p className="font-medium">{f.questionId} <span className="font-normal text-muted">· {f.reason} · {when(f.createdAt)}</span></p>
                  {f.comment ? <p className="whitespace-pre-wrap text-sm">{f.comment}</p> : null}
                  <div><Button variant="secondary" disabled={busyId === f.id} onClick={() => void toggle(f)}>{f.status === 'open' ? 'Mark resolved' : 'Reopen'}</Button></div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Server backups" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Server backups</h2>
        {state.backupError ? <p role="alert" className="text-danger">Could not load backup records: {state.backupError}</p> : state.backups.length === 0 ? (
          <Card><p>No backup has been recorded here. Backups made by the scheduled job are listed in the GitHub repository under Actions (see docs/BACKUP.md); this list only shows runs written to the database.</p></Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.backups.map((b) => (
              <li key={b.id}><Card className="text-sm"><p className="font-medium">{b.status} · {when(b.startedAt)}</p><p className="text-muted">{size(b.sizeBytes)} · {b.destination ?? 'no destination'} · verified {when(b.verifiedAt)}</p>{b.errorMessage ? <p className="text-danger">{b.errorMessage}</p> : null}</Card></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
