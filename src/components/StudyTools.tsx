import { useState, type FormEvent } from 'react'
import { Badge } from './bits'
import { Button, Card } from './ui'
import { FLAG_REASONS, NOTE_MAX, addFlag, flagsFor, isBookmarked, noteFor, removeFlag, setNote, toggleBookmark, type FlagReason } from '../userdata/model'
import { updateUserData, useUserData } from '../userdata/store'

const REASON_TEXT: Record<FlagReason, string> = {
  incorrect: 'The answer or explanation is wrong',
  unclear: 'The question is unclear',
  outdated: 'The content is out of date',
  typo: 'Spelling or typing mistake',
  other: 'Something else',
}

/** Bookmark, note and "report a problem" for one question. Everything is saved on this device first. */
export default function StudyTools({ userId, questionId }: { userId: string; questionId: string }) {
  const data = useUserData(userId)
  const [error, setError] = useState<string | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [reason, setReason] = useState<FlagReason>('incorrect')
  const [comment, setComment] = useState('')
  const saved = noteFor(data, questionId)
  const [draft, setDraft] = useState(saved?.body ?? '')
  const [noteStatus, setNoteStatus] = useState<string | null>(null)
  const flags = flagsFor(data, questionId)
  const marked = isBookmarked(data, questionId)

  const report = (r: { ok: boolean; error?: string }) => setError(r.ok ? null : (r.error ?? 'Could not save.'))
  const now = () => new Date().toISOString()

  function saveNote(e: FormEvent) {
    e.preventDefault()
    const r = updateUserData(userId, (d) => setNote(d, questionId, draft, now()))
    report(r)
    setNoteStatus(r.ok ? (draft.trim() ? 'Note saved.' : 'Note removed.') : null)
  }

  function sendFlag(e: FormEvent) {
    e.preventDefault()
    const r = updateUserData(userId, (d) => addFlag(d, questionId, reason, comment, now()))
    report(r)
    if (r.ok) {
      setFlagOpen(false)
      setComment('')
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Study tools</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-pressed={marked} onClick={() => report(updateUserData(userId, (d) => toggleBookmark(d, questionId, now())))}>
          {marked ? '★ Bookmarked' : '☆ Bookmark'}
        </Button>
        <Button variant="secondary" aria-expanded={flagOpen} onClick={() => setFlagOpen((o) => !o)}>Report a problem</Button>
      </div>

      {flags.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your reports on this question">
          {flags.map((f) => (
            <li key={f.reason} className="flex items-center gap-1">
              <Badge tone="bad">{REASON_TEXT[f.reason]}</Badge>
              <button type="button" className="min-h-12 px-2 text-sm underline" aria-label={`Withdraw report: ${REASON_TEXT[f.reason]}`}
                onClick={() => report(updateUserData(userId, (d) => removeFlag(d, questionId, f.reason)))}>Withdraw</button>
            </li>
          ))}
        </ul>
      ) : null}

      {flagOpen ? (
        <form onSubmit={sendFlag} className="flex flex-col gap-2" aria-label="Report a problem">
          <label htmlFor={`reason-${questionId}`} className="text-sm font-medium">What is wrong?</label>
          <select id={`reason-${questionId}`} className="min-h-12 rounded-xl border border-line bg-surface px-3" value={reason} onChange={(e) => setReason(e.target.value as FlagReason)}>
            {FLAG_REASONS.map((r) => <option key={r} value={r}>{REASON_TEXT[r]}</option>)}
          </select>
          <label htmlFor={`comment-${questionId}`} className="text-sm font-medium">Comment (optional)</label>
          <textarea id={`comment-${questionId}`} className="min-h-24 rounded-xl border border-line bg-surface p-3" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit">Send report</Button>
            <Button type="button" variant="ghost" onClick={() => setFlagOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <form onSubmit={saveNote} className="flex flex-col gap-2" aria-label="Personal note">
        <label htmlFor={`note-${questionId}`} className="text-sm font-medium">My note (private)</label>
        <textarea id={`note-${questionId}`} className="min-h-24 rounded-xl border border-line bg-surface p-3" maxLength={NOTE_MAX}
          value={draft} onChange={(e) => { setDraft(e.target.value); setNoteStatus(null) }} />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary">Save note</Button>
          <p role="status" className="text-sm text-muted">{noteStatus}</p>
        </div>
      </form>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
    </Card>
  )
}
