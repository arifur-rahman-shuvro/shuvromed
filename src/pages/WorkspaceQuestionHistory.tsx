import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { describeContent } from '../bank/describe'
import { changedParts, restoreInput, useHistoryRepo, type ChangedPart } from '../bank/history'
import { Button, Card, Skeleton } from '../components/ui'
import { TYPE_INFO } from '../questions/registry'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { byVersion, type VersionRow as AnswerVersionRow } from '../revision/analytics'
import { useSessionRepo } from '../session/repo'
import { useWorkspaceEnabled } from '../workspace/flag'
import type { VersionRow } from '../workspace/sync/remote'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const WORDS: Record<ChangedPart, string> = { wording: 'wording', answers: 'answers', explanation: 'explanation', reference: 'reference', difficulty: 'difficulty' }
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

/** Every saved version of one question, and a way to put an old one back (as a NEW version; history is never rewritten). */
export default function WorkspaceQuestionHistory() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const qr = useQuestionRepo()
  const history = useHistoryRepo()
  const sessions = useSessionRepo()
  const sync = useWorkspaceSync()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const [question, setQuestion] = useState<WQuestion | null>(null)
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [results, setResults] = useState<AnswerVersionRow[]>([])

  const latest = useRef(0)
  const load = useCallback(async () => {
    const mine = ++latest.current // an older load that finishes late must not overwrite a newer one
    setError(null)
    const q = await qr.get(id)
    if (mine !== latest.current) return
    // On a device that has not finished its first sync, a question that is not here yet may simply not have arrived: keep waiting.
    const firstSyncPending = !!sync && sync.snapshot.lastSyncAt === null && sync.snapshot.state !== 'offline' && sync.snapshot.state !== 'error'
    if (!q.data && !q.error && firstSyncPending) return
    if (q.error || !q.data) { setMissing(true); return }
    setQuestion(q.data)
    const [v, a] = await Promise.all([history.versions(id), sessions.allAttempts()])
    if (mine !== latest.current) return
    if (v.error || !v.data) { setError(v.error ?? 'Could not load the history.'); setVersions(null); return }
    setVersions(v.data)
    setResults(a.data ? byVersion(a.data, id) : [])
  }, [qr, history, sessions, id, sync])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])

  if (!enabled) return <Navigate to="/app/settings" replace />
  if (missing) return <Navigate to="/app/workspace/questions" replace state={{ notice: 'That question no longer exists.' }} />

  async function putBack(v: VersionRow) {
    if (!question) return
    const r = restoreInput(question, v)
    if (!r.ok) { setError(r.error); setConfirm(null); return }
    const saved = await qr.update(question.id, r.input)
    setConfirm(null)
    if (saved.error) { setError(saved.error); return }
    setError(null)
    setNotice(`Version ${v.version} is back as your current wording. It becomes a new version once it syncs.`)
    await load()
  }

  const current = question?.version ?? null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Version history</h1>
        <Link className="underline" to="/app/workspace/questions">My questions</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}
      {question ? <Card><p>{question.stem}</p><p className="mt-1 text-sm text-muted">{TYPE_INFO[question.type].label} · current version {current ?? 'not synced yet'}</p></Card> : <Skeleton className="h-16 w-full" />}
      <p className="text-sm text-muted">A new version is saved each time the wording, answers, explanation, reference or difficulty change. Tags, topics and archiving do not make a version. Putting an old version back saves it as a new one, so nothing is ever lost.</p>
      <div role="status" aria-live="polite">{notice ? <p className="text-muted">{notice}</p> : null}</div>
      {error ? <div><p role="alert" className="text-danger">{error}</p><Button className="mt-2" variant="secondary" onClick={() => void load()}>Try again</Button></div> : null}
      {!error && versions === null ? <div role="status" aria-label="Loading"><Skeleton className="h-20 w-full" /></div> : null}
      {versions && versions.length === 0 ? <p>No versions yet. This question has not synced to the server.</p> : null}
      {versions ? (
        <ol className="flex flex-col gap-3">
          {versions.map((v, i) => {
            const parts = changedParts(versions[i + 1], v)
            const isCurrent = v.version === current
            return (
              <li key={v.version}>
                <Card>
                  <div role="group" aria-label={`Version ${v.version}`}>
                    <p className="font-medium">Version {v.version}{isCurrent ? ' (current)' : ''} <span className="font-normal text-muted">· {when(v.created_at)}</span></p>
                    <p className="text-sm text-muted">{versions[i + 1] ? (parts.length ? `Changed: ${parts.map((p) => WORDS[p]).join(', ')}` : 'No visible change') : 'First version'} · {v.subject_name}</p>
                    <p className="mt-2 whitespace-pre-wrap">{v.stem}</p>
                    <ul className="mt-1 text-sm">{describeContent(v.question_type as never, v.content).map((l, k) => <li key={k}>{l}</li>)}</ul>
                    {v.explanation ? <p className="mt-1 text-sm text-muted">Explanation: {v.explanation}</p> : null}
                    {(() => { const r = results.find((x) => x.version === v.version); return r ? <p className="mt-1 text-sm">Your answers to this version: {r.answers} ({r.correct} correct, {r.partial} partly, {r.incorrect} wrong)</p> : <p className="mt-1 text-sm text-muted">Not answered in this version.</p> })()}
                    {!isCurrent ? (
                      confirm === v.version ? (
                        <div className="mt-2 rounded-xl border border-line bg-surface2 p-3">
                          <p className="text-sm">Replace the current wording and answers with version {v.version}? The current text stays in the history.</p>
                          <div className="mt-2 flex gap-2"><Button onClick={() => void putBack(v)}>Put it back</Button><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button></div>
                        </div>
                      ) : <Button className="mt-2" variant="secondary" aria-label={`Put back version ${v.version}`} onClick={() => setConfirm(v.version)}>Put this version back</Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
