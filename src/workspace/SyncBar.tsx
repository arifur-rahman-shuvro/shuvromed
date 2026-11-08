import { Button } from '../components/ui'
import { plural } from './model'
import type { WorkspaceSync } from './WorkspaceProvider'

const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'

export default function SyncBar({ sync }: { sync: WorkspaceSync }) {
  const { snapshot: sn, persistent } = sync
  const text =
    sn.state === 'off' ? 'Saved on this device only (no server connection).'
    : sn.state === 'syncing' ? 'Syncing…'
    : sn.state === 'offline' ? (sn.pending ? `Offline. ${plural(sn.pending, 'change')} saved on this device, will sync when you are back online.` : 'Offline. Everything shown is saved on this device.')
    : sn.pending ? `${plural(sn.pending, 'change')} waiting to sync.`
    : sn.state === 'error' ? 'Sync problem. Your changes are safe on this device.'
    : 'All changes saved.'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm" aria-label="Sync status">
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" aria-live="polite" className="mr-auto">{text}</p>
        <button type="button" className={small + ' border border-line'} onClick={sync.syncNow} disabled={sn.state === 'syncing'}>Sync now</button>
      </div>
      {!persistent ? <p role="alert" className="text-danger">This browser cannot keep data on the device, so changes are lost if you close the app before they sync.</p> : null}
      {sn.state === 'error' && sn.errors.length ? <p className="text-muted">{sn.errors[0]}</p> : null}
      {sn.rejected.length ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-danger">The server refused {plural(sn.rejected.length, 'change')}:</p>
          <ul className="list-disc pl-5">{sn.rejected.map((r) => <li key={r.table + r.id}>{r.label}: {r.message}</li>)}</ul>
          <div><Button variant="secondary" onClick={sync.discardRejected}>Discard {sn.rejected.length === 1 ? 'that change' : 'those changes'}</Button></div>
        </div>
      ) : null}
    </div>
  )
}
