import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card } from '../components/ui'
import { useQuestionRepo } from '../questions/repo'
import { useTagRepo } from '../tags/repo'
import { buildExport, exportFileName } from '../transfer/export'
import { readJsonFile } from '../transfer/file'
import { PROMPT_KIT } from '../transfer/kit'
import { readPaste } from '../transfer/paste'
import { buildPlan, type Plan } from '../transfer/plan'
import { runImport, type ImportSummary } from '../transfer/run'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural } from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const SHOW = 30
const area = 'min-h-48 w-full rounded-xl border border-line bg-surface p-3 font-mono text-sm'

/** Import (paste or file) with a dry-run report first, export everything, and the prompt kit. Hidden behind the workspace switch. */
export default function WorkspaceImport() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const sync = useWorkspaceSync()
  const [text, setText] = useState('')
  const [allowDupes, setAllowDupes] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  if (!enabled) return <Navigate to="/app/settings" replace />

  async function snapshot() {
    const [w, t, q] = await Promise.all([ws.load(), tagRepo.list(), qr.list()])
    if (w.error || !w.data || t.error || !t.data || q.error || !q.data) throw new Error(w.error ?? t.error ?? q.error ?? 'Could not read your workspace.')
    return { subjects: w.data.subjects, topics: w.data.topics, tags: t.data, questions: q.data }
  }
  const read = (src: string) => (/^\s*[[{]/.test(src) ? readJsonFile(src) : readPaste(src))

  async function check(src = text, dupes = allowDupes) {
    setError(null); setResult(null); setBusy(true)
    try { setPlan(buildPlan(read(src), await snapshot(), { duplicates: dupes ? 'add' : 'skip' })) } catch (e) { setError(e instanceof Error ? e.message : 'Could not check.') }
    setBusy(false)
  }
  async function pickFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setError('That file is larger than 10 MB. Split it into smaller files.'); return }
    const src = await file.text()
    setText(src)
    await check(src)
  }
  async function doImport() {
    if (!plan) return
    setBusy(true); setError(null); setProgress({ done: 0, total: plan.counts.add })
    const r = await runImport(plan, { ws, tags: tagRepo, questions: qr }, (done, total) => setProgress({ done, total }))
    setBusy(false); setProgress(null)
    if (r.data) { setResult(r.data); setPlan(null); setText('') }
    if (r.error) setError(r.error)
  }
  async function doExport() {
    setExportNote(null)
    try {
      const file = buildExport(await snapshot())
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = exportFileName()
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setExportNote(`Exported ${plural(file.questions.length, 'question')}. Check your Downloads folder.`)
    } catch (e) { setExportNote(e instanceof Error ? e.message : 'Could not export.') }
  }
  async function copyKit() {
    try { await navigator.clipboard.writeText(PROMPT_KIT); setCopyNote('Copied. Paste it into your chatbot, then add your notes at the end.') } catch { setCopyNote('Could not copy automatically. Press and hold the text above to select it, then copy.') }
  }

  const problemItems = plan ? plan.items.filter((i) => i.status !== 'add' || i.problems.length) : []
  const creates = plan ? plan.newSubjects.length + plan.newTopics.length + plan.newTags.length : 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Import and export</h1>
        <Link className="underline" to="/app/workspace/questions">My questions</Link>
      </div>
      {sync ? <SyncBar sync={sync} /> : null}

      <section aria-label="Import" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Import questions</h2>
        <p className="text-sm text-muted">Paste questions as text, or choose a ShuvroMed .json file. You see a report first; nothing is saved until you press Import.</p>
        <label className="flex flex-col gap-1 text-sm font-medium">Paste questions here
          <textarea className={area} value={text} onChange={(e) => { setText(e.target.value); setPlan(null); setResult(null) }} spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">Or choose a file (.json or .txt)
          <input type="file" accept=".json,.txt,text/plain,application/json" className="min-h-12" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={allowDupes} onChange={(e) => { setAllowDupes(e.target.checked); setPlan(null) }} /> Add questions even if the same wording already exists
        </label>
        <div><Button onClick={() => void check()} disabled={busy || !text.trim()}>Check</Button></div>
        {error ? <p role="alert" className="text-danger">{error}</p> : null}

        {plan ? (
          <Card>
            <div role="region" aria-label="Import report" className="flex flex-col gap-2">
              {plan.fatal ? <p role="alert" className="text-danger">{plan.fatal}</p> : (
                <>
                  <p className="font-medium">
                    {plural(plan.counts.add, 'question')} will be added
                    {plan.counts.duplicate ? `, ${plural(plan.counts.duplicate, 'duplicate')} skipped` : ''}
                    {plan.counts.error + plan.unreadable.length ? `, ${plural(plan.counts.error + plan.unreadable.length, 'question')} with problems left out` : ''}.
                  </p>
                  {creates ? (
                    <p className="text-sm text-muted">
                      Will also create: {[plan.newSubjects.length ? plural(plan.newSubjects.length, 'subject') : '', plan.newTopics.length ? plural(plan.newTopics.length, 'topic') : '', plan.newTags.length ? plural(plan.newTags.length, 'tag') : ''].filter(Boolean).join(', ')}.
                      {plan.newSubjects.length ? ` New subjects: ${plan.newSubjects.slice(0, 10).join(', ')}${plan.newSubjects.length > 10 ? '…' : ''}.` : ''}
                    </p>
                  ) : null}
                  {plan.unreadable.length || problemItems.length ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {[...plan.unreadable.map((u) => ({ label: u.label, text: u.problems.join(' '), kind: 'error' })), ...problemItems.map((i) => ({ label: i.label, text: i.problems.join(' '), kind: i.status }))].slice(0, SHOW).map((p, idx) => (
                        <li key={idx}><span className="font-medium">{p.label}</span>: <span className={p.kind === 'error' ? 'text-danger' : 'text-muted'}>{p.text}</span></li>
                      ))}
                      {plan.unreadable.length + problemItems.length > SHOW ? <li className="text-muted">…and {plan.unreadable.length + problemItems.length - SHOW} more.</li> : null}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void doImport()} disabled={busy || plan.counts.add === 0}>{`Import ${plural(plan.counts.add, 'question')}`}</Button>
                  </div>
                  {plan.counts.error + plan.unreadable.length ? <p className="text-sm text-muted">Fix the lines above and press Check again to include them, or import the rest now.</p> : null}
                </>
              )}
            </div>
          </Card>
        ) : null}
        {progress ? <p role="status" aria-live="polite">Importing… {progress.done} of {progress.total}</p> : null}
        {result ? (
          <div role="status" aria-live="polite">
            <p className="font-medium">Imported {plural(result.added, 'question')}.</p>
            {result.createdSubjects + result.createdTopics + result.createdTags ? <p className="text-sm text-muted">Created {plural(result.createdSubjects, 'subject')}, {plural(result.createdTopics, 'topic')} and {plural(result.createdTags, 'tag')}.</p> : null}
            {result.failed.length ? <ul className="text-sm text-danger">{result.failed.slice(0, SHOW).map((f, i) => <li key={i}>{f.label}: {f.error}</li>)}</ul> : null}
            <Link className="underline" to="/app/workspace/questions">Open My questions</Link>
          </div>
        ) : null}
      </section>

      <section aria-label="Export" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Export</h2>
        <p className="text-sm text-muted">Downloads all your questions with their subjects, topics and tags as one .json file. You can import that file again here, on this or another account. Deleted questions are left out.</p>
        <div><Button variant="secondary" onClick={() => void doExport()}>Download all my questions</Button></div>
        <p role="status" aria-live="polite" className="text-sm text-muted">{exportNote}</p>
      </section>

      <section aria-label="Prompt kit" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Prompt kit for a chatbot</h2>
        <p className="text-sm text-muted">Typing questions on a phone is slow. Copy this into any chatbot, add your notes at the end, then paste its reply above.</p>
        <pre tabIndex={0} aria-label="Prompt kit text" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface2 p-3 text-xs">{PROMPT_KIT}</pre>
        <div><Button variant="secondary" onClick={() => void copyKit()}>Copy prompt</Button></div>
        <p role="status" aria-live="polite" className="text-sm text-muted">{copyNote}</p>
      </section>
    </div>
  )
}
