import { Button } from '../components/ui'
import { applyUpdate, dismissNeedRefresh, dismissOfflineReady, usePwa } from './register'

/** Update and offline-ready notices. Sits above the phone tab bar and never covers the whole screen. */
export default function PwaPrompt() {
  const { needRefresh, offlineReady } = usePwa()
  if (!needRefresh && !offlineReady) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-md rounded-2xl border border-line bg-surface p-4 shadow-lg md:bottom-4">
      {needRefresh ? (
        <>
          <p className="font-medium">A new version of ShuvroMed is ready.</p>
          <p className="mt-1 text-sm text-muted">Reloading ends a practice session you are in the middle of. Answers you already gave stay saved.</p>
          <div className="mt-3 flex gap-3">
            <Button onClick={applyUpdate}>Reload now</Button>
            <Button variant="secondary" onClick={dismissNeedRefresh}>Later</Button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">ShuvroMed can now open without internet.</p>
          <p className="mt-1 text-sm text-muted">Questions you have opened are saved too. Settings can save all of them.</p>
          <div className="mt-3">
            <Button variant="secondary" onClick={dismissOfflineReady}>OK</Button>
          </div>
        </>
      )}
    </div>
  )
}
