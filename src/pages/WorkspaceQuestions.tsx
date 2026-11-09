import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { activeFilterCount, applyFilter, buildSearchIndex, EMPTY_FILTER, isDefaultFilter, parseFilter, sortQuestions, type BankFilter, type SortChoice } from '../bank/filter'
import { useSavedFilterRepo, type SavedFilter } from '../bank/saved'
import FilterPanel from '../bank/ui/FilterPanel'
import { Button, Card, EmptyState, LinkButton, Skeleton } from '../components/ui'
import { useQuestionRepo, type WQuestion } from '../questions/repo'
import { stemPreview, TYPE_INFO } from '../questions/registry'
import { isUniversal, useTagRepo, type WTag } from '../tags/repo'
import { useWorkspaceEnabled } from '../workspace/flag'
import { plural, type WSubject, type WTopic } from '../workspace/model'
import SyncBar from '../workspace/SyncBar'
import { useWorkspaceSync } from '../workspace/WorkspaceProvider'
import { useWorkspaceRepo } from '../workspace/repo'

const small = 'min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface2'
const input = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'
const PAGE = 50
const KEEP = 'shuvromed-bank-view'

function readKept(): { filter: BankFilter; sort: SortChoice } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEEP) ?? 'null') as { filter?: unknown; sort?: SortChoice } | null
    return { filter: parseFilter(raw?.filter), sort: raw?.sort === 'edited-old' || raw?.sort === 'wording' ? raw.sort : 'edited-new' }
  } catch { return { filter: { ...EMPTY_FILTER }, sort: 'edited-new' } }
}

/** The question bank: search, filters, saved filters, bulk actions. Hidden behind the workspace switch until the cutover. */
export default function WorkspaceQuestions() {
  const { user } = useAuth()
  const enabled = useWorkspaceEnabled(user?.id)
  const ws = useWorkspaceRepo()
  const qr = useQuestionRepo()
  const tagRepo = useTagRepo()
  const savedRepo = useSavedFilterRepo()
  const sync = useWorkspaceSync()
  const location = useLocation()
  const dataVersion = sync?.snapshot.dataVersion ?? 0
  const kept = useRef(readKept()).current
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [questions, setQuestions] = useState<WQuestion[]>([])
  const [subjects, setSubjects] = useState<WSubject[]>([])
  const [topics, setTopics] = useState<WTopic[]>([])
  const [tags, setTags] = useState<WTag[]>([])
  const [saved, setSaved] = useState<SavedFilter[]>([])
  const [filter, setFilter] = useState<BankFilter>(kept.filter)
  const [sort, setSort] = useState<SortChoice>(kept.sort)
  const [panel, setPanel] = useState(false)
  const [visible, setVisible] = useState(PAGE)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkTag, setBulkTag] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [confirmMove, setConfirmMove] = useState(false)
  const [savedId, setSavedId] = useState('')
  const [saveName, setSaveName] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; undo?: () => void; error?: boolean } | null>((location.state as { notice?: string } | null)?.notice ? { text: (location.state as { notice: string }).notice } : null)
  const indexRef = useRef<ReturnType<typeof buildSearchIndex>>(new Map())

  const load = useCallback(async () => {
    const [w, q, tg, sv] = await Promise.all([ws.load(), qr.list(), tagRepo.list(), savedRepo.list()])
    if (w.error || !w.data || q.error || !q.data || tg.error || !tg.data) { setStatus('error'); return }
    setSubjects(w.data.subjects)
    setTopics(w.data.topics)
    setTags(tg.data)
    setSaved(sv.data ?? [])
    indexRef.current = buildSearchIndex(q.data, indexRef.current)
    setQuestions(q.data)
    setStatus('ready')
  }, [ws, qr, tagRepo, savedRepo])
  useEffect(() => { if (enabled) void load() }, [enabled, load, dataVersion])
  useEffect(() => { try { sessionStorage.setItem(KEEP, JSON.stringify({ filter, sort })) } catch { /* private window: the view just is not remembered */ } }, [filter, sort])

  const deferredText = useDeferredValue(filter.text)
  const effective = useMemo(() => ({ ...filter, text: deferredText }), [filter, deferredText])
  const results = useMemo(
    () => sortQuestions(applyFilter(questions, effective, { topics, tags, index: indexRef.current }), sort),
    [questions, effective, topics, tags, sort],
  )
  useEffect(() => { setVisible(PAGE) }, [effective, sort])

  if (!enabled) return <Navigate to="/app/settings" replace />

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? 'Unknown subject'
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? ''
  const resultIds = results.map((q) => q.id)
  const pickedIds = resultIds.filter((id) => picked.has(id))
  const activeTags = tags.filter((t) => !t.archived)
  const changed = activeFilterCount(filter)
  const currentSaved = saved.find((s) => s.id === savedId)
  const togglePick = (id: string, on: boolean) => setPicked((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n })
  const say = (text: string, undo?: () => void) => setNotice({ text, undo })
  const fail = (text: string) => setNotice({ text, error: true })

  async function bulkTags(mode: 'add' | 'remove') {
    if (!bulkTag) return fail('Choose a tag first.')
    const ids = pickedIds
    const r = await qr.bulkTags(ids, mode === 'add' ? { add: [bulkTag] } : { remove: [bulkTag] })
    if (r.error || !r.data) return fail(r.error ?? 'Could not change the tags.')
    const undoChange = mode === 'add' ? { remove: [bulkTag] } : { add: [bulkTag] }
    const n = r.data.changed
    say(`${mode === 'add' ? 'Added' : 'Removed'} "${tagName(bulkTag)}" ${mode === 'add' ? 'to' : 'from'} ${plural(n, 'question')}.`, n ? () => { void qr.bulkTags(ids, undoChange).then(load).then(() => say('Undone.')) } : undefined)
    await load()
  }
  async function bulkState(change: { archived?: boolean; deleted?: boolean }, done: string) {
    const ids = pickedIds
    const r = await qr.bulkState(ids, change)
    if (r.error || !r.data) return fail(r.error ?? 'Could not change the questions.')
    const n = r.data.changed
    const back = change.archived !== undefined ? { archived: !change.archived } : { deleted: !change.deleted }
    say(`${done} ${plural(n, 'question')}.`, n ? () => { void qr.bulkState(ids, back).then(load).then(() => say('Undone.')) } : undefined)
    setPicked(new Set())
    await load()
  }
  async function doMove() {
    if (!moveTo) return fail('Choose a subject first.')
    const r = await qr.bulkMove(pickedIds, moveTo)
    setConfirmMove(false)
    if (r.error || !r.data) return fail(r.error ?? 'Could not move the questions.')
    say(`Moved ${plural(r.data.changed, 'question')} to ${subjectName(moveTo)}${r.data.topicsCleared ? `; ${plural(r.data.topicsCleared, 'topic link')} cleared` : ''}.`)
    setPicked(new Set())
    await load()
  }
  async function toggleArchive(q: WQuestion) {
    const r = await qr.setArchived(q.id, !q.archived)
    if (r.error) return fail(r.error)
    say(q.archived ? 'Restored.' : 'Archived. It is hidden but nothing was deleted.')
    await load()
  }
  async function remove(q: WQuestion) {
    const r = await qr.setDeleted(q.id, true)
    if (r.error) return fail(r.error)
    say('Question deleted. Its history is kept.', () => { void qr.setDeleted(q.id, false).then(load).then(() => say('Question restored.')) })
    await load()
  }
  function applySaved(id: string) {
    setSavedId(id)
    const s = saved.find((x) => x.id === id)
    if (s) { setFilter(s.filter); setSort(s.sort) }
  }
  async function saveCurrent() {
    const r = await savedRepo.create(saveName ?? '', filter, sort)
    if (r.error || !r.data) return fail(r.error ?? 'Could not save the filter.')
    setSaveName(null); setSavedId(r.data.id)
    say(`Saved filter "${r.data.name}".`)
    await load()
  }
  async function updateSaved() {
    if (!currentSaved) return
    const r = await savedRepo.update(currentSaved.id, filter, sort)
    if (r.error) return fail(r.error)
    say(`Updated "${currentSaved.name}".`)
    await load()
  }
  async function deleteSaved() {
    if (!currentSaved) return
    const r = await savedRepo.remove(currentSaved.id)
    if (r.error) return fail(r.error)
    say(`Deleted saved filter "${currentSaved.name}".`)
    setSavedId('')
    await load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">My questions</h1>
        <Button variant="secondary" onClick={() => { setSelecting((v) => !v); setPicked(new Set()); setConfirmMove(false) }}>{selecting ? 'Done selecting' : 'Select'}</Button>
        <LinkButton variant="secondary" to="/app/workspace/practice">Practice</LinkButton>
        <LinkButton to="/app/workspace/questions/new">Add question</LinkButton>
      </div>
      <p className="text-muted">Your own questions, private to you. <Link className="underline" to="/app/workspace/subjects">Subjects and topics</Link> · <Link className="underline" to="/app/workspace/tags">Tags</Link> · <Link className="underline" to="/app/workspace/import">Import / export</Link></p>
      {sync ? <SyncBar sync={sync} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">Search questions
          <input type="search" className={input} value={filter.text} placeholder="Wording, options, answers, explanation" onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        </label>
        <Button variant="secondary" aria-expanded={panel} onClick={() => setPanel((v) => !v)}>{`Filters${changed ? ` (${changed})` : ''}`}</Button>
        {!isDefaultFilter(filter) ? <Button variant="secondary" onClick={() => { setFilter({ ...EMPTY_FILTER }); setSavedId('') }}>Clear filters</Button> : null}
      </div>

      {panel ? (
        <>
          <FilterPanel filter={filter} onChange={(f) => setFilter(f)} sort={sort} onSort={setSort} subjects={subjects} topics={topics} tags={tags} />
          <div role="group" aria-label="Saved filters" className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <label className="flex flex-col gap-1 text-sm font-medium">Saved filters
              <select className={input} value={savedId} onChange={(e) => applySaved(e.target.value)}>
                <option value="">{saved.length ? 'Choose a saved filter…' : 'None saved yet'}</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {saveName === null ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setSaveName('')}>Save current filter</Button>
                {currentSaved ? <Button variant="secondary" onClick={() => void updateSaved()}>{`Update "${currentSaved.name}"`}</Button> : null}
                {currentSaved ? <Button variant="secondary" onClick={() => void deleteSaved()}>{`Delete "${currentSaved.name}"`}</Button> : null}
              </div>
            ) : (
              <form className="flex flex-col gap-2" aria-label="Save filter" onSubmit={(e) => { e.preventDefault(); void saveCurrent() }}>
                <label className="flex flex-col gap-1 text-sm font-medium">Name for this filter
                  <input className={input} value={saveName} maxLength={80} onChange={(e) => setSaveName(e.target.value)} />
                </label>
                <div className="flex gap-2"><Button type="submit">Save filter</Button><Button type="button" variant="secondary" onClick={() => setSaveName(null)}>Cancel</Button></div>
              </form>
            )}
          </div>
        </>
      ) : null}

      {selecting ? (
        <Card>
          <div role="group" aria-label="Bulk actions" className="flex flex-col gap-3">
            <p className="text-sm font-medium">{plural(pickedIds.length, 'question')} selected</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPicked(new Set(resultIds))}>{`Select all ${results.length} matching`}</Button>
              <Button variant="secondary" onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">Tag
              <select className={input} value={bulkTag} onChange={(e) => setBulkTag(e.target.value)}>
                <option value="">Choose a tag…</option>
                {activeTags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!pickedIds.length} onClick={() => void bulkTags('add')}>Add tag</Button>
              <Button variant="secondary" disabled={!pickedIds.length} onClick={() => void bulkTags('remove')}>Remove tag</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!pickedIds.length} onClick={() => void bulkState({ archived: true }, 'Archived')}>Archive selected</Button>
              <Button variant="secondary" disabled={!pickedIds.length} onClick={() => void bulkState({ archived: false }, 'Restored')}>Restore selected</Button>
              <Button variant="secondary" disabled={!pickedIds.length} onClick={() => void bulkState({ deleted: true }, 'Deleted')}>Delete selected</Button>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">Move to subject
              <select className={input} value={moveTo} onChange={(e) => { setMoveTo(e.target.value); setConfirmMove(false) }}>
                <option value="">Choose a subject…</option>
                {[...subjects].sort((a, b) => a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {confirmMove ? (
              <div role="group" aria-label="Confirm move" className="rounded-xl border border-line bg-surface2 p-3">
                <p className="text-sm">Move {plural(pickedIds.length, 'question')} to {subjectName(moveTo)}? Their topics belong to the old subject, so topics are cleared. Tags are kept.</p>
                <div className="mt-2 flex gap-2"><Button onClick={() => void doMove()}>Move questions</Button><Button variant="secondary" onClick={() => setConfirmMove(false)}>Cancel</Button></div>
              </div>
            ) : <div><Button variant="secondary" disabled={!pickedIds.length || !moveTo} onClick={() => setConfirmMove(true)}>Move selected</Button></div>}
          </div>
        </Card>
      ) : null}

      <div role="status" aria-live="polite">
        {notice ? (
          <p className={notice.error ? 'text-danger' : 'text-muted'} role={notice.error ? 'alert' : undefined}>
            {notice.text} {notice.undo ? <button type="button" className="ml-1 min-h-11 font-medium underline" onClick={notice.undo}>Undo</button> : null}
          </p>
        ) : null}
      </div>

      {status === 'loading' ? <div role="status" aria-label="Loading"><Skeleton className="h-20 w-full" /></div> : null}
      {status === 'error' ? <Card><p role="alert">Could not open your questions.</p><Button className="mt-3" variant="secondary" onClick={() => void load()}>Try again</Button></Card> : null}
      {status === 'ready' ? <p aria-live="polite" className="text-sm text-muted">{plural(results.length, 'question')}{changed ? ' match' : ''}{changed ? ` your filters (of ${questions.filter((q) => !q.deleted).length})` : ''}</p> : null}
      {status === 'ready' && results.length === 0 ? (
        <EmptyState title={questions.length === 0 ? 'No questions yet' : 'No questions match'} body={questions.length === 0 ? 'Press Add question to write your first one, or use Import / export. You need at least one subject.' : 'Change the search or clear the filters.'} />
      ) : null}
      {status === 'ready' ? (
        <ul className="flex flex-col gap-3">
          {results.slice(0, visible).map((q) => (
            <li key={q.id}>
              <Card>
                {selecting ? <label className="mb-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={picked.has(q.id)} onChange={(e) => togglePick(q.id, e.target.checked)} aria-label={`Select: ${stemPreview(q.stem, 40)}`} /> Select</label> : null}
                <p className={q.archived ? 'text-muted' : ''}>{stemPreview(q.stem, 160)}</p>
                <p className="mt-1 text-sm text-muted">
                  {TYPE_INFO[q.type].label} · {subjectName(q.subjectId)}{q.topicIds.length ? ` · ${plural(q.topicIds.length, 'topic')}` : ''}{q.difficulty ? ` · ${q.difficulty}` : ''}{q.archived ? ' · archived' : ''}
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-xs">
                  {isUniversal(q.tagIds, tags) ? <span className="rounded-full border border-line px-2 py-0.5">Universal</span> : null}
                  {q.tagIds.filter((id) => tagName(id)).map((id) => <span key={id} className="rounded-full bg-surface2 px-2 py-0.5">{tagName(id)}</span>)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Link className={small + ' inline-flex items-center border border-line'} to={`/app/workspace/questions/${q.id}`} aria-label={`Edit: ${stemPreview(q.stem, 40)}`}>Edit</Link>
                  <Link className={small + ' inline-flex items-center'} to={`/app/workspace/questions/${q.id}/history`} aria-label={`History: ${stemPreview(q.stem, 40)}`}>History</Link>
                  <button type="button" className={small} onClick={() => void toggleArchive(q)} aria-label={`${q.archived ? 'Restore' : 'Archive'}: ${stemPreview(q.stem, 40)}`}>{q.archived ? 'Restore' : 'Archive'}</button>
                  <button type="button" className={small} onClick={() => void remove(q)} aria-label={`Delete: ${stemPreview(q.stem, 40)}`}>Delete</button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      {status === 'ready' && results.length > visible ? <div><Button variant="secondary" onClick={() => setVisible((v) => v + PAGE)}>{`Show ${Math.min(PAGE, results.length - visible)} more`}</Button></div> : null}
    </div>
  )
}
