import { useState } from 'react'
import { Button } from '../../components/ui'
import { isUniversal, type TagCategory, type TagRepo, type WTag } from '../repo'

const GROUPS: { category: TagCategory; title: string; hint: string }[] = [
  { category: 'exam', title: 'Exam tags (optional)', hint: 'Which exams this question is for.' },
  { category: 'general', title: 'General tags (optional)', hint: 'Your own labels, such as high yield.' },
]

/** Pick tags for a question. A question with no exam tag is Universal, so it is available to every exam. */
export default function TagPicker({ tags, selected, onChange, repo, onTagCreated }: {
  tags: WTag[]
  selected: string[]
  onChange: (ids: string[]) => void
  repo: TagRepo
  onTagCreated: () => void
}) {
  const [category, setCategory] = useState<TagCategory>('exam')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id))

  async function add() {
    setError(null)
    const r = await repo.create(category, name)
    if (r.error || !r.data) { setError(r.error ?? 'Could not add the tag.'); return }
    setName('')
    onChange([...selected, r.data.id])
    onTagCreated()
  }

  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map((g) => {
        const list = tags.filter((t) => t.category === g.category && (!t.archived || selected.includes(t.id)))
        return (
          <fieldset key={g.category} className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{g.title}</legend>
            {list.length === 0 ? <p className="text-sm text-muted">{g.hint} None yet.</p> : (
              <div className="flex max-h-48 flex-col overflow-auto rounded-xl border border-line">
                {list.map((t) => (
                  <label key={t.id} className="flex min-h-11 items-center gap-3 px-3">
                    <input type="checkbox" className="size-5" checked={selected.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                    {t.name}{t.archived ? ' (archived)' : ''}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )
      })}
      <p className="text-sm text-muted">{isUniversal(selected, tags) ? 'Universal: no exam tag, so this question is available to every exam.' : 'This question is limited to its exam tags.'}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-medium">New tag group
          <select className="min-h-12 rounded-xl border border-line bg-surface px-3 text-base" value={category} onChange={(e) => setCategory(e.target.value as TagCategory)}>
            <option value="exam">Exam</option>
            <option value="general">General</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">New tag name
          <input className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button type="button" variant="secondary" onClick={() => void add()} disabled={!name.trim()}>Add tag</Button>
      </div>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
    </div>
  )
}
