import { useCallback, useEffect, useState } from 'react'
import { Button, Card } from '../components/ui'
import { downloadAllForOffline, offlineStatus, type OfflineStatus } from './offlineContent'

/** Lets a student save the whole question bank on the phone for use without internet. */
export default function OfflineCard() {
  const supported = typeof caches !== 'undefined'
  const [status, setStatus] = useState<OfflineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    if (supported) setStatus(await offlineStatus())
  }, [supported])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function download() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await downloadAllForOffline()
      setMessage({ kind: 'ok', text: `Saved ${r.subjects} ${r.subjects === 1 ? 'subject' : 'subjects'} on this device. You can practise without internet.` })
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setMessage({
        kind: 'error',
        text: offline ? 'You are offline. Connect to the internet and try again.' : `Could not save the questions (${e instanceof Error ? e.message : 'unknown error'}). Nothing was changed.`,
      })
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  if (!supported) return null
  const all = status !== null && status.total > 0 && status.saved === status.total
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Use without internet</h2>
      <p className="text-sm text-muted">
        {status === null
          ? 'ShuvroMed keeps the app and the questions you open on this device.'
          : all
            ? `All ${status.total} ${status.total === 1 ? 'subject is' : 'subjects are'} saved on this device.`
            : `${status.saved} of ${status.total} subjects are saved on this device.`}{' '}
        Your answers are always saved on this device first and sync when you are online.
      </p>
      <div>
        <Button variant="secondary" onClick={() => void download()} disabled={busy}>
          {busy ? 'Saving…' : all ? 'Check for updates' : 'Save all questions for offline'}
        </Button>
      </div>
      {message ? (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${message.kind === 'error' ? 'border-danger text-danger' : 'border-success'}`}>
          {message.text}
        </p>
      ) : null}
    </Card>
  )
}
