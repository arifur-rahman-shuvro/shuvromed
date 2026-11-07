import { useOnline } from '../lib/useOnline'
import { useSync } from '../sync/SyncContext'

/** One short line in the header telling the student whether their progress is safe on the server. */
export default function SyncStatus() {
  const { state, pending, errors, syncNow } = useSync()
  const online = useOnline()
  const base = 'text-xs text-muted'
  // Shown the moment the connection drops, not only when the next sync attempt fails.
  if (!online) return <p role="status" className={base}>Offline · answers are saved on this device{pending ? ` · ${pending} waiting to sync` : ''}</p>
  if (state === 'off') return <p role="status" className={base}>Saved on this device only</p>
  if (state === 'syncing') return <p role="status" className={base}>Syncing…</p>
  if (state === 'offline') return <p role="status" className={base}>Offline{pending ? ` · ${pending} waiting to sync` : ''}</p>
  if (state === 'error') {
    return (
      <p role="status" className="flex items-center gap-1 text-xs text-danger">
        <span title={errors.join('\n')}>Sync problem{pending ? ` · ${pending} waiting` : ''}</span>
        <button type="button" onClick={syncNow} className="min-h-12 rounded-xl px-3 font-medium underline">Try again</button>
      </p>
    )
  }
  return <p role="status" className={base}>{pending ? `${pending} waiting to sync` : 'All changes synced'}</p>
}
