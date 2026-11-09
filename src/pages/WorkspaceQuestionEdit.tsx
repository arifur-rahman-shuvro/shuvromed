import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Skeleton } from '../components/ui'
import { useQuestionRepo, type QuestionInput, type WQuestion } from '../questions/repo'
import { TYPE_INFO } from '../questions/registry'
import { DIFFICULTIES, QUESTION_TYPES, validateQuestion, type Difficulty, type QuestionContent, type QuestionType } from '../questions/schema'
import ContentEditor from '../questions/ui/ContentEditor'
import QuestionView from '../questions/ui/QuestionView'
import { useTagRepo, type WTag } from '../tags/repo'
import TagPicker from '../tags/ui/TagPicker'
import { useWorkspaceEnabled } from '../workspace/flag'
import { buildTopicTree, flatten, type WSubject, type WTopic } from '../workspace/model'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'
import { useWorkspaceRepo } from '../workspace/repo'

interface Draft {
  subjectId: string
  type: QuestionType
  stem: string
  difficulty: Difficulty | ''
  explanation: string
  reference: string
  topicIds: string[]
  tagIds: string[]
  content: QuestionContent
}

const field = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'
const emptyDraft = (type: QuestionType = 'SBA'): Draft => ({ subjectId: '', type, stem: '', difficulty: '', explanation: '', reference: '', topicIds: [], tagIds: [], content: TYPE_INFO[type].blank() })
const fromQuestion = (q: WQuestion): Draft => ({ subjectId: q.subjectId, type: q.type, stem: q.stem, difficulty: q.difficulty ?? '', explanation: q.explanation ?? '', reference: q.reference ?? '', topicIds: q.topicIds, tagIds: q.tagIds, content: structuredClone(q.content) })
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

export default function WorkspaceQuestionEdit() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const { id } = useParams()
  const editing = id !== undefined && id !== 'new'
  const navigate = useNavigate()
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const sync = useWorkspaceSync()
  const draftKey = editing ? `edit-${id}` : 'new'

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [topics, setTopics] = useState<WTopic[]>([])
  const [tags, setTags] = useState<WTag[]>([])
  const [saved, setSaved] = useState<Draft>(emptyDraft())
  const [d, setD] = useState<Draft>(emptyDraft())
  const [restorable, setRestorable] = useState<Draft | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [showProblems, setShowProblems] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dupes, setDupes] = useState<WQuestion[]>([])
  const [draftSaved, setDraftSaved] = useState(false)
  const loaded = useRef(false)

  const load = useCallback(async () => {
    const w = await ws.load()
    if (w.error || !w.data) { setStatus('error'); return }
    setSubjects(w.data.subjects)
    setTopics(w.data.topics)
    const tg = await tagRepo.list()
    if (tg.data) setTags(tg.data)
    let base = emptyDraft()
    if (editing) {
      const q = await qr.get(id as string)
      if (q.error) { setStatus('error'); return }
      if (!q.data || q.data.deleted) { setStatus('missing'); return }
      base = fromQuestion(q.data)
    }
    setSaved(base)
    setD(base)
    const draft = await qr.loadDraft<Draft>(draftKey)
    if (draft && !same(draft, base)) setRestorable(draft)
    loaded.current = true
    setStatus('ready')
  }, [ws, qr, editing, id, draftKey])
  useEffect(() => { if (enabled) void load() }, [enabled, load])

  const dirty = !same(d, saved)
  // Keep an unsaved draft on the device so a phone call or a closed tab loses nothing.
  useEffect(() => {
    if (status !== 'ready' || !loaded.current || !dirty || restorable) return
    const t = setTimeout(() => { void qr.saveDraft(draftKey, d).then(() => setDraftSaved(true)) }, 800)
    return () => clearTimeout(t)
  }, [d, dirty, status, qr, draftKey, restorable])

  // Warn about another question with the same wording.
  useEffect(() => {
    if (status !== 'ready') return
    const t = setTimeout(() => { void qr.findDuplicates(d.stem, editing ? id : undefined).then((r) => setDupes(r.data ?? [])) }, 400)
    return () => clearTimeout(t)
  }, [d.stem, status, qr, editing, id])

  const validation = useMemo(() => validateQuestion(d.type, d.stem, d.content), [d.type, d.stem, d.content])
  const problems = [
    ...(d.subjectId ? [] : [{ path: 'subject', message: 'Choose a subject.' }]),
    ...(validation.ok ? [] : validation.problems),
  ]
  const subjectTopics = useMemo(() => (d.subjectId ? flatten(buildTopicTree(topics, d.subjectId, false)) : []), [topics, d.subjectId])
  const subjectName = (sid: string) => subjects.find((s) => s.id === sid)?.name ?? ''

  if (!enabled) return <Navigate to="/app/settings" replace />

  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }))
  const toInput = (): QuestionInput => ({
    subjectId: d.subjectId, type: d.type, stem: d.stem, difficulty: d.difficulty || null, content: d.content,
    explanation: d.explanation, reference: d.reference, topicIds: d.topicIds, tagIds: d.tagIds,
  })

  async function save() {
    setShowProblems(true)
    setSaveError(null)
    if (problems.length) return
    setBusy(true)
    const r = editing ? await qr.update(id as string, toInput()) : await qr.create(toInput())
    setBusy(false)
    if (r.error || !r.data) { setSaveError(r.error ?? 'Could not save.'); return }
    await qr.clearDraft(draftKey)
    navigate('/app/workspace/questions', { state: { notice: editing ? 'Question saved.' : 'Question added.' } })
  }
  async function discardDraft() { await qr.clearDraft(draftKey); setRestorable(null) }

  if (status === 'loading') return <div role="status" aria-label="Loading"><Skeleton className="h-40 w-full" /></div>
  if (status === 'error') return <p role="alert">Could not open your workspace. Go back and try again.</p>
  if (status === 'missing') return <div className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Question not found</h1><p className="text-muted">It may have been deleted on another device.</p><Link className="underline" to="/app/workspace/questions">Back to my questions</Link></div>

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{editing ? 'Edit question' : 'New question'}</h1>
      {sync ? <SyncBar sync={sync} /> : null}

      {restorable ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-line bg-surface2 p-3">
          <p>You have an unsaved draft of this question from earlier.</p>
          <div className="flex gap-2">
            <Button onClick={() => { setD({ ...emptyDraft(restorable.type), ...restorable }); setRestorable(null) }}>Restore draft</Button>
            <Button variant="secondary" onClick={() => void discardDraft()}>Discard draft</Button>
          </div>
        </div>
      ) : null}

      {subjects.filter((s) => !s.archived).length === 0 && !d.subjectId ? (
        <p className="rounded-xl border border-line p-3">A question needs a subject. <Link className="underline" to="/app/workspace/subjects">Add a subject first.</Link></p>
      ) : null}

      <div role="tablist" aria-label="Editor view" className="flex gap-2">
        {(['edit', 'preview'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} className={`min-h-11 flex-1 rounded-xl border px-3 font-medium ${tab === t ? 'border-brand bg-brand text-brandfg' : 'border-line'}`} onClick={() => setTab(t)}>{t === 'edit' ? 'Edit' : 'Preview'}</button>
        ))}
      </div>

      {tab === 'preview' ? (
        <div role="tabpanel" aria-label="Preview" className="flex flex-col gap-3">
          {validation.ok ? (
            <>
              <p className="text-sm text-muted">This is how the question looks when you practise. Try answering it.</p>
              <QuestionView key={JSON.stringify([d.type, d.stem, d.content])} question={{ type: d.type, stem: validation.stem, content: validation.content, explanation: d.explanation, reference: d.reference }} />
            </>
          ) : (
            <div role="status" className="rounded-xl border border-line p-3"><p className="font-medium">Fix these before you can preview it:</p><ul className="list-disc pl-5">{validation.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Edit" className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">Type
            {editing ? (
              <span className="min-h-12 rounded-xl border border-line px-3 py-3 text-base font-normal">{TYPE_INFO[d.type].label} <span className="text-muted">(a question’s type cannot be changed; make a new question instead)</span></span>
            ) : (
              <select className={field} value={d.type} onChange={(e) => { const t = e.target.value as QuestionType; set({ type: t, content: TYPE_INFO[t].blank() }) }}>
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">Subject (required)
            <select className={field} value={d.subjectId} onChange={(e) => set({ subjectId: e.target.value, topicIds: [] })}>
              <option value="">Choose a subject…</option>
              {subjects.filter((s) => !s.archived || s.id === d.subjectId).sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.archived ? ' (archived)' : ''}</option>)}
            </select>
          </label>

          {d.subjectId && subjectTopics.length ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Topics in {subjectName(d.subjectId)} (optional)</legend>
              <div className="flex max-h-56 flex-col overflow-auto rounded-xl border border-line">
                {subjectTopics.map((t) => (
                  <label key={t.id} className="flex min-h-11 items-center gap-3 px-3" style={{ paddingLeft: 12 + Math.min(t.depth, 6) * 16 }}>
                    <input type="checkbox" className="size-5" checked={d.topicIds.includes(t.id)} onChange={(e) => set({ topicIds: e.target.checked ? [...d.topicIds, t.id] : d.topicIds.filter((x) => x !== t.id) })} />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <TagPicker tags={tags} selected={d.tagIds} onChange={(ids) => set({ tagIds: ids })} repo={tagRepo} onTagCreated={() => { void tagRepo.list().then((r) => { if (r.data) setTags(r.data) }) }} />

          <label className="flex flex-col gap-1 text-sm font-medium">
            {d.type === 'FILL_GAP' ? 'Question (use {{b1}} where the missing word goes)' : d.type === 'TRUE_FALSE' ? 'Statement' : 'Question'}
            <textarea className={field + ' py-2'} rows={d.type === 'FILL_GAP' ? 4 : 5} value={d.stem} onChange={(e) => set({ stem: e.target.value })} />
          </label>

          {dupes.length ? (
            <div role="status" className="rounded-xl border border-line bg-surface2 p-3 text-sm">
              <p className="font-medium">Another question has the same wording.</p>
              <ul className="list-disc pl-5">{dupes.slice(0, 3).map((q) => <li key={q.id}><Link className="underline" to={`/app/workspace/questions/${q.id}`}>Open it</Link>{q.archived ? ' (archived)' : ''}</li>)}</ul>
              <p className="text-muted">You can still save this one.</p>
            </div>
          ) : null}

          <ContentEditor type={d.type} stem={d.stem} content={d.content} onStem={(s) => set({ stem: s })} onContent={(c) => set({ content: c })} />

          <label className="flex flex-col gap-1 text-sm font-medium">Explanation (optional)
            <textarea className={field + ' py-2'} rows={3} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Reference (optional)
            <input className={field} value={d.reference} onChange={(e) => set({ reference: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Difficulty (optional)
            <select className={field} value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty | '' })}>
              <option value="">Not set</option>
              {DIFFICULTIES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
            </select>
          </label>
        </div>
      )}

      {showProblems && problems.length ? (
        <div role="alert" className="rounded-xl border border-danger p-3">
          <p className="font-medium text-danger">Fix {problems.length === 1 ? 'this' : 'these'} to save:</p>
          <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        </div>
      ) : null}
      {saveError ? <p role="alert" className="text-danger">{saveError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={busy}>{editing ? 'Save changes' : 'Add question'}</Button>
        <Link className="inline-flex min-h-12 items-center rounded-xl border border-line px-4" to="/app/workspace/questions">Cancel</Link>
        {dirty && draftSaved ? <span className="text-sm text-muted" role="status">Draft kept on this device</span> : null}
      </div>
    </div>
  )
}
