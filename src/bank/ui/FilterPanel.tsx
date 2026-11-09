import type { ReactNode } from 'react'
import { DIFFICULTIES, QUESTION_TYPES, type QuestionType } from '../../questions/schema'
import { TYPE_INFO } from '../../questions/registry'
import type { WTag } from '../../tags/repo'
import { topicPath, type WSubject, type WTopic } from '../../workspace/model'
import type { BankFilter, DifficultyChoice, SortChoice, StateChoice, UniversalChoice } from '../filter'

const select = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="flex flex-col gap-1"><legend className="text-sm font-medium">{title}</legend>{children}</fieldset>
}
function Checks<T extends string>({ items, chosen, onChange, label }: { items: { value: T; label: string }[]; chosen: T[]; onChange: (v: T[]) => void; label: string }) {
  if (!items.length) return <p className="text-sm text-muted">None yet.</p>
  return (
    <div className="flex max-h-44 flex-col overflow-auto rounded-xl border border-line" role="group" aria-label={label}>
      {items.map((i) => (
        <label key={i.value} className="flex min-h-11 items-center gap-3 px-3">
          <input type="checkbox" className="size-5" checked={chosen.includes(i.value)} onChange={(e) => onChange(e.target.checked ? [...chosen, i.value] : chosen.filter((x) => x !== i.value))} />
          {i.label}
        </label>
      ))}
    </div>
  )
}

/** All the ways to narrow the bank. Choices inside a group are OR; different groups are AND. */
export default function FilterPanel({ filter, onChange, sort, onSort, subjects, topics, tags }: {
  filter: BankFilter
  onChange: (f: BankFilter) => void
  sort: SortChoice
  onSort: (s: SortChoice) => void
  subjects: WSubject[]
  topics: WTopic[]
  tags: WTag[]
}) {
  const set = (patch: Partial<BankFilter>) => onChange({ ...filter, ...patch })
  const subjectOptions = [...subjects].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name + (s.archived ? ' (archived)' : '') }))
  // Topics of the chosen subjects (all topics when no subject is chosen), shown as full paths.
  const topicOptions = topics
    .filter((t) => !filter.subjectIds.length || filter.subjectIds.includes(t.subjectId))
    .map((t) => ({ value: t.id, label: (filter.subjectIds.length === 1 ? '' : `${subjects.find((s) => s.id === t.subjectId)?.name ?? ''} › `) + topicPath(topics, t.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const exam = tags.filter((t) => t.category === 'exam').map((t) => ({ value: t.id, label: t.name }))
  const general = tags.filter((t) => t.category === 'general').map((t) => ({ value: t.id, label: t.name }))
  return (
    <div role="group" aria-label="Filters" className="flex flex-col gap-4 rounded-xl border border-line p-3">
      <Group title="Subject"><Checks label="Subjects" items={subjectOptions} chosen={filter.subjectIds} onChange={(v) => set({ subjectIds: v })} /></Group>
      <Group title="Topic (includes its sub-topics)">
        <Checks label="Topics" items={topicOptions} chosen={filter.topicIds} onChange={(v) => set({ topicIds: v })} />
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={filter.noTopic} onChange={(e) => set({ noTopic: e.target.checked })} /> Only questions with no topic</label>
      </Group>
      <Group title="Type"><Checks<QuestionType> label="Types" items={QUESTION_TYPES.map((t) => ({ value: t, label: TYPE_INFO[t].label }))} chosen={filter.types} onChange={(v) => set({ types: v })} /></Group>
      <Group title="Exam tags"><Checks label="Exam tags" items={exam} chosen={filter.examTagIds} onChange={(v) => set({ examTagIds: v })} /></Group>
      <Group title="General tags">
        <Checks label="General tags" items={general} chosen={filter.generalTagIds} onChange={(v) => set({ generalTagIds: v })} />
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={filter.noTags} onChange={(e) => set({ noTags: e.target.checked })} /> Only questions with no tags at all</label>
      </Group>
      <label className="flex flex-col gap-1 text-sm font-medium">Exam scope
        <select className={select} value={filter.universal} onChange={(e) => set({ universal: e.target.value as UniversalChoice })}>
          <option value="any">Any</option>
          <option value="only">Universal only (no exam tag)</option>
          <option value="exam">With an exam tag</option>
        </select>
      </label>
      <Group title="Difficulty">
        <Checks<DifficultyChoice> label="Difficulty" items={[...DIFFICULTIES.map((d) => ({ value: d as DifficultyChoice, label: d[0].toUpperCase() + d.slice(1) })), { value: 'none' as DifficultyChoice, label: 'Not set' }]} chosen={filter.difficulties} onChange={(v) => set({ difficulties: v })} />
      </Group>
      <label className="flex flex-col gap-1 text-sm font-medium">Show
        <select className={select} value={filter.state} onChange={(e) => set({ state: e.target.value as StateChoice })}>
          <option value="active">Active questions</option>
          <option value="archived">Archived only</option>
          <option value="all">Active and archived</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">Sort by
        <select className={select} value={sort} onChange={(e) => onSort(e.target.value as SortChoice)}>
          <option value="edited-new">Recently edited first</option>
          <option value="edited-old">Oldest edited first</option>
          <option value="wording">Wording A to Z</option>
        </select>
      </label>
    </div>
  )
}
