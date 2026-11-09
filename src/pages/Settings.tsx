import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearLocalData } from '../account/localData'
import { useServerClients } from '../account/clients'
import { useAuth } from '../auth/AuthContext'
import { attemptsToCsv, buildExport, exportFileName, exportToText } from '../backup/export'
import { applyImport, parseImport, planImport, type ImportReport } from '../backup/restore'
import { Button, Card, LinkButton } from '../components/ui'
import { getGamification } from '../gamification/pref'
import { downloadText, readFileText } from '../lib/download'
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme'
import { loadMock } from '../mock/store'
import { loadAttempts, useAttempts } from '../practice/attempts'
import { MAX_DAILY_GOAL, MIN_DAILY_GOAL, getDailyGoal, setDailyGoal, useDailyGoal } from '../prefs/settings'
import { loadUserData } from '../userdata/store'
import type { ExportFile } from '../backup/export'
import { CountInput } from '../components/bits'
import OfflineCard from '../pwa/OfflineCard'
import { setWorkspaceEnabled, useWorkspaceEnabled } from '../workspace/flag'

const DELETE_WORD = 'DELETE'
const label: Record<keyof ImportReport, string> = { attempts: 'answers', collections: 'collections', bookmarks: 'bookmarks', notes: 'notes', flags: 'reports', mockResults: 'mock exams' }

function ReportList({ report }: { report: ImportReport }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {(Object.keys(report) as (keyof ImportReport)[]).map((k) => (
        <li key={k} className="flex justify-between gap-3"><span>{label[k][0].toUpperCase() + label[k].slice(1)}</span><span className="tabular-nums">{report[k].add} new · {report[k].skip} already here</span></li>
      ))}
    </ul>
  )
}

export default function Settings() {
  const { user, signOut } = useAuth()
  const { account, admin } = useServerClients()
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let live = true
    void admin?.isAdmin().then((v) => { if (live) setIsAdmin(v) })
    return () => { live = false }
  }, [admin])
  const navigate = useNavigate()
  const userId = user?.id
  const attempts = useAttempts(userId)
  const goal = useDailyGoal(userId)
  const workspaceOn = useWorkspaceEnabled(userId)
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref())
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [preview, setPreview] = useState<{ file: ExportFile; report: ImportReport; name: string } | null>(null)
  const [restored, setRestored] = useState<ImportReport | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  if (!userId) return null

  const exportJson = async () => {
    try {
      const file = await buildExport({ attempts: loadAttempts(userId), userData: loadUserData(userId), mockResults: loadMock(userId).results, settings: { dailyGoal: getDailyGoal(userId), gamification: getGamification(userId) } })
      downloadText(exportFileName(new Date(), 'json'), exportToText(file), 'application/json')
      setMessage({ kind: 'ok', text: 'Backup downloaded. Keep the file somewhere safe: it holds your answers and notes.' })
    } catch {
      setMessage({ kind: 'error', text: 'The backup could not be created. Nothing was changed.' })
    }
  }
  const exportCsv = () => {
    downloadText(exportFileName(new Date(), 'csv'), attemptsToCsv(loadAttempts(userId)), 'text/csv')
    setMessage({ kind: 'ok', text: 'Answers downloaded as a spreadsheet file.' })
  }

  const choose = async (f: File | undefined) => {
    setMessage(null); setRestored(null); setPreview(null)
    if (!f) return
    try {
      const parsed = await parseImport(await readFileText(f))
      if (!parsed.ok) return setMessage({ kind: 'error', text: parsed.error })
      const plan = planImport(parsed.file, { attempts: loadAttempts(userId), userData: loadUserData(userId), mockResults: loadMock(userId).results })
      setPreview({ file: parsed.file, report: plan.report, name: f.name })
    } catch {
      setMessage({ kind: 'error', text: 'That file could not be read.' })
    } finally {
      if (picker.current) picker.current.value = ''
    }
  }
  const restore = () => {
    if (!preview) return
    const r = applyImport(userId, preview.file)
    setPreview(null)
    if (!r.ok) return setMessage({ kind: 'error', text: r.error ?? 'The backup could not be restored.' })
    setRestored(r.report)
    setMessage({ kind: 'ok', text: 'Backup restored. New items will sync to your account shortly.' })
  }

  const deleteAccount = async () => {
    if (!account) return setMessage({ kind: 'error', text: 'The server is not configured, so the account cannot be deleted from here.' })
    setBusy(true)
    const { error } = await account.deleteMyAccount()
    setBusy(false)
    if (error) return setMessage({ kind: 'error', text: `The account was not deleted: ${error}. Your data is unchanged.` })
    clearLocalData(userId)
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-sm text-muted">{user?.email}</p>

      {message ? <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 ${message.kind === 'error' ? 'border-danger text-danger' : 'border-success'}`}>{message.text}</p> : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Study</h2>
        <label htmlFor="goal" className="font-medium">Daily goal (questions per day)</label>
        <CountInput id="goal" value={goal} max={MAX_DAILY_GOAL} className="min-h-12 w-32 rounded-xl border border-line bg-surface px-3" onValue={(n) => setDailyGoal(userId, n)} />
        <p className="text-xs text-muted">Between {MIN_DAILY_GOAL} and {MAX_DAILY_GOAL}. Saved on this device.</p>
        <label htmlFor="theme" className="font-medium">Appearance</label>
        <select id="theme" className="min-h-12 rounded-xl border border-line bg-surface px-3" value={theme} onChange={(e) => { const v = e.target.value as ThemePref; setTheme(v); applyTheme(v) }}>
          <option value="system">Match my phone</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Experimental: private workspace</h2>
        <p className="mt-1 text-sm text-muted">Your own subjects, topics and questions, kept private to your account. Still being built; it is off by default and changes nothing else in the app.</p>
        <label className="mt-3 flex min-h-12 items-center gap-3">
          <input type="checkbox" className="size-5" checked={workspaceOn} onChange={(e) => setWorkspaceEnabled(userId, e.target.checked)} />
          <span className="font-medium">Show my private workspace</span>
        </label>
        {workspaceOn ? <div className="mt-2 flex flex-wrap gap-2"><LinkButton variant="secondary" to="/app/workspace/subjects">Open My subjects</LinkButton><LinkButton variant="secondary" to="/app/workspace/questions">Open My questions</LinkButton><LinkButton variant="secondary" to="/app/workspace/tags">Open My tags</LinkButton><LinkButton variant="secondary" to="/app/workspace/import">Open Import / export</LinkButton></div> : null}
      </Card>
      <OfflineCard />

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-muted">{attempts.length} {attempts.length === 1 ? 'answer' : 'answers'} on this device. A backup file holds your answers, bookmarks, collections, notes, reports and finished mock exams. It does not contain your email or password.</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={exportJson}>Download backup</Button>
          <Button variant="secondary" onClick={exportCsv} disabled={attempts.length === 0}>Download answers (CSV)</Button>
        </div>
        <hr className="border-line" />
        <label htmlFor="restore" className="font-medium">Restore from a backup file</label>
        <input id="restore" ref={picker} type="file" accept=".json,application/json" className="min-h-12 text-sm" onChange={(e) => void choose(e.target.files?.[0])} />
        <p className="text-xs text-muted">Restoring only adds what is missing. Nothing you already have is replaced or deleted, and restoring the same file twice changes nothing.</p>
        {preview ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
            <p className="font-medium">Ready to restore from {preview.name}</p>
            <ReportList report={preview.report} />
            <div className="flex gap-3"><Button onClick={restore}>Restore now</Button><Button variant="secondary" onClick={() => setPreview(null)}>Cancel</Button></div>
          </div>
        ) : null}
        {restored ? <div aria-label="Restore result" className="rounded-xl border border-line p-3"><ReportList report={restored} /></div> : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Account</h2>
        {isAdmin ? <div><LinkButton to="/app/admin" variant="secondary">Admin area</LinkButton></div> : null}
        {!deleting ? (
          <div><Button variant="secondary" onClick={() => setDeleting(true)}>Delete my account…</Button></div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-danger p-3">
            <p className="font-medium text-danger">This permanently deletes your account and every answer, bookmark and note stored for it. It cannot be undone.</p>
            <p className="text-sm">Download a backup first if you want to keep your data. Type <strong>{DELETE_WORD}</strong> to confirm.</p>
            <label htmlFor="confirm-delete" className="sr-only">Type {DELETE_WORD} to confirm</label>
            <input id="confirm-delete" className="min-h-12 rounded-xl border border-line bg-surface px-3" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" autoCapitalize="characters" />
            <div className="flex gap-3">
              <Button onClick={() => void deleteAccount()} disabled={confirmText !== DELETE_WORD || busy} className="bg-danger text-white">{busy ? 'Deleting…' : 'Delete everything'}</Button>
              <Button variant="secondary" onClick={() => { setDeleting(false); setConfirmText('') }}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
