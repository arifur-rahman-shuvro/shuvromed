import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ErrorBox, ListSkeleton } from '../components/bits'
import { Button, EmptyState, LinkButton } from '../components/ui'
import { buildTopicTree, flattenTree } from '../content/tree'
import { DIFFICULTIES } from '../content/schema'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { useAttempts } from '../practice/attempts'
import { practiceContext } from '../practice/context'
import { useUserData } from '../userdata/store'
import { configToParams, newSeed, paramsToConfig } from '../practice/params'
import { MAX_SESSION_QUESTIONS, clampCount, matchingQuestions, type PracticeConfig, type PracticeMode } from '../practice/session'
import { SECONDS_PER_QUESTION } from '../practice/scoring'

const field = 'min-h-12 w-full rounded-xl border border-line bg-surface px-3'
const label = 'mb-1 block text-sm font-medium'

export default function PracticeSetup() {
  const cat = useCatalog()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const attempts = useAttempts(user?.id)
  const userData = useUserData(user?.id)
  const [cfg, setCfg] = useState<PracticeConfig>(() => paramsToConfig(params))
  const qs = useQuestions(cfg.subjectId ? [cfg.subjectId] : null)

  const topicOptions = useMemo(
    () => (cat.status === 'ready' && cfg.subjectId ? flattenTree(buildTopicTree(cat.catalog.taxonomy.topics, cfg.subjectId)) : []),
    [cat, cfg.subjectId],
  )

  if (cat.status === 'loading') return <ListSkeleton rows={5} />
  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  const { taxonomy } = cat.catalog

  const set = <K extends keyof PracticeConfig>(k: K, v: PracticeConfig[K]) => setCfg((c) => ({ ...c, [k]: v }))
  const available = qs.status === 'ready' ? matchingQuestions(qs.questions, taxonomy.topics, cfg, attempts, practiceContext(attempts, userData)).length : null
  const willUse = available === null ? null : Math.min(available, clampCount(cfg.count))

  function start(e: FormEvent) {
    e.preventDefault()
    navigate(`/app/practice/play?${configToParams(cfg, newSeed()).toString()}`)
  }

  if (cat.catalog.manifest.totalQuestions === 0) {
    return <EmptyState title="No questions available yet" body="There are no published questions to practise." action={<LinkButton to="/app/subjects">Browse subjects</LinkButton>} />
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-5" aria-label="Practice setup">
      <h1 className="text-2xl font-bold">Practice setup</h1>

      <div>
        <label htmlFor="subject" className={label}>Subject</label>
        <select id="subject" className={field} value={cfg.subjectId ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, subjectId: e.target.value || null, topicId: null }))}>
          <option value="">All subjects</option>
          {taxonomy.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="topic" className={label}>Topic</label>
        <select id="topic" className={field} value={cfg.topicId ?? ''} disabled={!cfg.subjectId}
          onChange={(e) => set('topicId', e.target.value || null)}>
          <option value="">{cfg.subjectId ? 'All topics' : 'Choose a subject first'}</option>
          {topicOptions.map((n) => <option key={n.topic.id} value={n.topic.id}>{'  '.repeat(n.depth)}{n.topic.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="style" className={label}>Exam style</label>
          <select id="style" className={field} value={cfg.examStyle ?? ''} onChange={(e) => set('examStyle', e.target.value || null)}>
            <option value="">Any style</option>
            {taxonomy.examStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="difficulty" className={label}>Difficulty</label>
          <select id="difficulty" className={field} value={cfg.difficulty ?? ''}
            onChange={(e) => set('difficulty', (e.target.value || null) as PracticeConfig['difficulty'])}>
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="count" className={label}>Number of questions (max {MAX_SESSION_QUESTIONS})</label>
          <input id="count" type="number" inputMode="numeric" min={1} max={MAX_SESSION_QUESTIONS} className={field} value={cfg.count}
            onChange={(e) => set('count', clampCount(Number(e.target.value)))} />
        </div>
      </div>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">Which questions</legend>
        <div className="flex flex-col gap-2">
          {([['all', 'All matching questions'], ['unattempted', 'Only questions I have not attempted'], ['incorrect', 'Only questions I last got wrong'], ['bookmarked', 'Only my bookmarked questions'], ['due', 'Only questions due for revision']] as [PracticeMode, string][]).map(([v, text]) => (
            <label key={v} className="flex min-h-12 items-center gap-3">
              <input type="radio" name="mode" value={v} checked={cfg.mode === v} onChange={() => set('mode', v)} className="size-5" />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">Options</legend>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={cfg.timed} onChange={(e) => set('timed', e.target.checked)} className="size-5" />
            Timed ({SECONDS_PER_QUESTION} seconds per question in total)
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={cfg.shuffleQuestions} onChange={(e) => set('shuffleQuestions', e.target.checked)} className="size-5" />
            Randomise question order
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={cfg.shuffleOptions} onChange={(e) => set('shuffleOptions', e.target.checked)} className="size-5" />
            Randomise answer options
          </label>
        </div>
      </fieldset>

      <div aria-live="polite" className="text-sm text-muted">
        {qs.status === 'error' ? 'Could not count questions.' : willUse === null ? 'Counting questions…' : available === 0 ? 'No questions match these settings.' : `${available} matching ${available === 1 ? 'question' : 'questions'}; this session will use ${willUse}.`}
      </div>

      <Button type="submit" disabled={!available}>Start practice</Button>
    </form>
  )
}
