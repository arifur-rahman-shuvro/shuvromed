import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, Skeleton } from '../components/ui'
import { useWorkspaceEnabled } from '../workspace/flag'
import {
  MAX_DESCRIPTION, MAX_SUBJECT_NAME, MAX_TOPIC_NAME, buildTopicTree, cleanName, deleteRefusal, moveTargets, topicPath, validateName,
  type TopicNode, type WSubject, type WTopic,
} from '../workspace/model'
import { useWorkspaceRepo } from '../workspace/repo'

type Action =
  | { kind: 'rename-subject'; id: string }
  | { kind: 'add-topic'; subjectId: string; parentId: string | null }
  | { kind: 'rename-topic'; id: string }
  | { kind: 'move-topic'; id: string }
  | { kind: 'delete-subject'; id: string }
  | { kind: 'delete-topic'; id: string }

const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'
const input = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'

function ActionFormBase({ label, children, submit, onSubmit, error, busy, onCancel }: { label: string; children?: React.ReactNode; submit: string; onSubmit: (e: React.FormEvent) => void; error: string | null; busy: boolean; onCancel: () => void }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface2 p-3" aria-label={label}>
      {children}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{submit}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

export default function WorkspaceSubjects() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const repo = useWorkspaceRepo()
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [topics, setTopics] = useState<WTopic[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const [field, setField] = useState('')
  const [target, setTarget] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    const r = await repo.load()
    if (r.error || !r.data) { setLoadError(r.error ?? 'Could not load.'); setStatus('error'); return }
    setSubjects(r.data.subjects)
    setTopics(r.data.topics)
    setStatus('ready')
  }, [repo])
  useEffect(() => { if (enabled) void load() }, [enabled, load])

  const visibleSubjects = useMemo(
    () => subjects.filter((s) => showArchived || !s.archived).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })),
    [subjects, showArchived],
  )

  if (!enabled) return <Navigate to="/app/settings" replace />

  const say = (kind: 'ok' | 'error', text: string) => setNotice({ kind, text })
  const begin = (a: Action, initial = '') => { setAction(a); setField(initial); setTarget(''); setFieldError(null) }
  const cancel = () => { setAction(null); setFieldError(null) }
  const upsertSubject = (s: WSubject) => setSubjects((l) => (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [...l, s]))
  const upsertTopic = (t: WTopic) => setTopics((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]))

  async function addSubject(e: React.FormEvent) {
    e.preventDefault()
    const err = validateName(newSubject, MAX_SUBJECT_NAME, subjects)
    if (err) { say('error', err); return }
    setBusy(true)
    const r = await repo.createSubject(cleanName(newSubject), null)
    setBusy(false)
    if (r.error || !r.data) { say('error', r.error ?? 'Could not add.'); return }
    upsertSubject(r.data)
    setNewSubject('')
    say('ok', `Added subject “${r.data.name}”.`)
  }

  async function submitAction(e: React.FormEvent) {
    e.preventDefault()
    if (!action) return
    setFieldError(null)
    setBusy(true)
    try {
      if (action.kind === 'rename-subject') {
        const err = validateName(field, MAX_SUBJECT_NAME, subjects, action.id)
        if (err) return setFieldError(err)
        const r = await repo.updateSubject(action.id, { name: cleanName(field) })
        if (r.error || !r.data) return setFieldError(r.error ?? 'Could not rename.')
        upsertSubject(r.data); say('ok', 'Subject renamed.')
      } else if (action.kind === 'add-topic') {
        const sibs = topics.filter((t) => t.subjectId === action.subjectId && t.parentId === action.parentId)
        const err = validateName(field, MAX_TOPIC_NAME, sibs)
        if (err) return setFieldError(err)
        const r = await repo.createTopic(action.subjectId, action.parentId, cleanName(field))
        if (r.error || !r.data) return setFieldError(r.error ?? 'Could not add.')
        upsertTopic(r.data); say('ok', `Added topic “${r.data.name}”.`)
      } else if (action.kind === 'rename-topic') {
        const t = topics.find((x) => x.id === action.id)
        if (!t) return
        const sibs = topics.filter((x) => x.subjectId === t.subjectId && x.parentId === t.parentId)
        const err = validateName(field, MAX_TOPIC_NAME, sibs, t.id)
        if (err) return setFieldError(err)
        const r = await repo.updateTopic(t.id, { name: cleanName(field) })
        if (r.error || !r.data) return setFieldError(r.error ?? 'Could not rename.')
        upsertTopic(r.data); say('ok', 'Topic renamed.')
      } else if (action.kind === 'move-topic') {
        const t = topics.find((x) => x.id === action.id)
        if (!t) return
        const parentId = target === '' ? null : target
        const sibs = topics.filter((x) => x.subjectId === t.subjectId && x.parentId === parentId)
        const err = validateName(t.name, MAX_TOPIC_NAME, sibs, t.id)
        if (err) return setFieldError(err)
        const r = await repo.updateTopic(t.id, { parentId })
        if (r.error || !r.data) return setFieldError(r.error ?? 'Could not move.')
        upsertTopic(r.data); say('ok', 'Topic moved.')
      } else if (action.kind === 'delete-subject') {
        const use = await repo.subjectUse(action.id)
        if (use.error || !use.data) return setFieldError(use.error ?? 'Could not check.')
        const why = deleteRefusal('subject', use.data)
        if (why) return setFieldError(why)
        const r = await repo.deleteSubject(action.id)
        if (r.error) return setFieldError(r.error)
        setSubjects((l) => l.filter((x) => x.id !== action.id)); say('ok', 'Subject deleted.')
      } else if (action.kind === 'delete-topic') {
        const use = await repo.topicUse(action.id)
        if (use.error || !use.data) return setFieldError(use.error ?? 'Could not check.')
        const why = deleteRefusal('topic', use.data)
        if (why) return setFieldError(why)
        const r = await repo.deleteTopic(action.id)
        if (r.error) return setFieldError(r.error)
        setTopics((l) => l.filter((x) => x.id !== action.id)); say('ok', 'Topic deleted.')
      }
      setAction(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggleSubject(s: WSubject) {
    const r = await repo.updateSubject(s.id, { archived: !s.archived })
    if (r.error || !r.data) return say('error', r.error ?? 'Could not update.')
    upsertSubject(r.data); say('ok', r.data.archived ? `Archived “${s.name}”. It is hidden but nothing was deleted.` : `Restored “${s.name}”.`)
  }
  async function toggleTopic(t: WTopic) {
    const r = await repo.updateTopic(t.id, { archived: !t.archived })
    if (r.error || !r.data) return say('error', r.error ?? 'Could not update.')
    upsertTopic(r.data); say('ok', r.data.archived ? `Archived “${t.name}”.` : `Restored “${t.name}”.`)
  }

  const nameField = (label: string, max: number) => (
    <label className="flex flex-col gap-1 text-sm font-medium">{label}
      <input className={input} value={field} maxLength={max + 40} onChange={(e) => setField(e.target.value)} autoFocus />
    </label>
  )

  function renderTopics(nodes: TopicNode[], subject: WSubject) {
    return (
      <ul className="flex flex-col gap-1">
        {nodes.map((n) => (
          <li key={n.id} style={{ marginLeft: Math.min(n.depth, 6) * 12 }}>
            <div className="flex flex-wrap items-center gap-x-1 rounded-lg border border-line px-3 py-1">
              <span className={`mr-auto py-2 ${n.archived ? 'text-muted line-through' : ''}`}>{n.name}{n.archived ? ' (archived)' : ''}</span>
              <button type="button" className={small} onClick={() => begin({ kind: 'add-topic', subjectId: subject.id, parentId: n.id })} aria-label={`Add sub-topic to ${n.name}`}>Add sub-topic</button>
              <button type="button" className={small} onClick={() => begin({ kind: 'rename-topic', id: n.id }, n.name)} aria-label={`Rename ${n.name}`}>Rename</button>
              <button type="button" className={small} onClick={() => begin({ kind: 'move-topic', id: n.id })} aria-label={`Move ${n.name}`}>Move</button>
              <button type="button" className={small} onClick={() => void toggleTopic(n)} aria-label={`${n.archived ? 'Restore' : 'Archive'} ${n.name}`}>{n.archived ? 'Restore' : 'Archive'}</button>
              <button type="button" className={small} onClick={() => begin({ kind: 'delete-topic', id: n.id })} aria-label={`Delete ${n.name}`}>Delete</button>
            </div>
            {action && 'id' in action && action.id === n.id && action.kind === 'rename-topic' ? (
              <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`Rename ${n.name}`} submit="Save name">{nameField('New name', MAX_TOPIC_NAME)}</ActionFormBase>
            ) : null}
            {action?.kind === 'move-topic' && action.id === n.id ? (
              <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`Move ${n.name}`} submit="Move here">
                <label className="flex flex-col gap-1 text-sm font-medium">New parent
                  <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Top level of {subject.name}</option>
                    {moveTargets(topics, n).map((t) => <option key={t.id} value={t.id}>{topicPath(topics, t.id)}</option>)}
                  </select>
                </label>
              </ActionFormBase>
            ) : null}
            {action?.kind === 'delete-topic' && action.id === n.id ? (
              <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`Delete ${n.name}`} submit={`Delete “${n.name}”`}>
                <p className="text-sm">Delete this topic? It can only be deleted if nothing is inside it. Otherwise archive it.</p>
              </ActionFormBase>
            ) : null}
            {action?.kind === 'add-topic' && action.parentId === n.id ? (
              <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`New sub-topic of ${n.name}`} submit="Add sub-topic">{nameField('Sub-topic name', MAX_TOPIC_NAME)}</ActionFormBase>
            ) : null}
            {n.children.length ? renderTopics(n.children, subject) : null}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">My subjects</h1>
      <p className="text-muted">Your private workspace starts empty. Add your own subjects, then topics inside them. Only you can see them.</p>

      <form onSubmit={addSubject} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">New subject name
          <input className={input} value={newSubject} maxLength={MAX_SUBJECT_NAME + 40} onChange={(e) => setNewSubject(e.target.value)} />
        </label>
        <Button type="submit" disabled={busy || status !== 'ready'}>Add subject</Button>
      </form>

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
      </label>

      <div role="status" aria-live="polite">
        {notice ? <p className={notice.kind === 'error' ? 'text-danger' : 'text-muted'} role={notice.kind === 'error' ? 'alert' : undefined}>{notice.text}</p> : null}
      </div>

      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-20 w-full" /></div> : null}
      {status === 'error' ? (
        <Card>
          <p role="alert">{loadError}</p>
          <Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button>
        </Card>
      ) : null}
      {status === 'ready' && visibleSubjects.length === 0 ? (
        <EmptyState title="No subjects yet" body="Type a name above and press Add subject to create your first one." />
      ) : null}

      {status === 'ready' ? (
        <ul className="flex flex-col gap-3">
          {visibleSubjects.map((s) => {
            const tree = buildTopicTree(topics, s.id, showArchived)
            const expanded = open === s.id
            return (
              <li key={s.id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-x-1">
                    <h2 className={`mr-auto text-lg font-semibold ${s.archived ? 'text-muted line-through' : ''}`}>{s.name}{s.archived ? ' (archived)' : ''}</h2>
                    <button type="button" className={small} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)} aria-label={`${expanded ? 'Hide' : 'Show'} topics of ${s.name}`}>{expanded ? 'Hide topics' : 'Topics'}</button>
                    <button type="button" className={small} onClick={() => begin({ kind: 'rename-subject', id: s.id }, s.name)} aria-label={`Rename ${s.name}`}>Rename</button>
                    <button type="button" className={small} onClick={() => void toggleSubject(s)} aria-label={`${s.archived ? 'Restore' : 'Archive'} ${s.name}`}>{s.archived ? 'Restore' : 'Archive'}</button>
                    <button type="button" className={small} onClick={() => begin({ kind: 'delete-subject', id: s.id })} aria-label={`Delete ${s.name}`}>Delete</button>
                  </div>
                  {s.description ? <p className="text-sm text-muted">{s.description.slice(0, MAX_DESCRIPTION)}</p> : null}
                  {action?.kind === 'rename-subject' && action.id === s.id ? <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`Rename ${s.name}`} submit="Save name">{nameField('New name', MAX_SUBJECT_NAME)}</ActionFormBase> : null}
                  {action?.kind === 'delete-subject' && action.id === s.id ? (
                    <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`Delete ${s.name}`} submit={`Delete “${s.name}”`}>
                      <p className="text-sm">Delete this subject? It can only be deleted if it has no topics or questions. Otherwise archive it.</p>
                    </ActionFormBase>
                  ) : null}
                  {expanded ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {tree.length === 0 ? <p className="text-sm text-muted">No topics yet. Topics are optional.</p> : renderTopics(tree, s)}
                      {action?.kind === 'add-topic' && action.subjectId === s.id && action.parentId === null ? (
                        <ActionFormBase onSubmit={submitAction} error={fieldError} busy={busy} onCancel={cancel} label={`New topic in ${s.name}`} submit="Add topic">{nameField('Topic name', MAX_TOPIC_NAME)}</ActionFormBase>
                      ) : (
                        <div><button type="button" className={small + ' border border-line'} onClick={() => begin({ kind: 'add-topic', subjectId: s.id, parentId: null })}>Add topic to {s.name}</button></div>
                      )}
                    </div>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
