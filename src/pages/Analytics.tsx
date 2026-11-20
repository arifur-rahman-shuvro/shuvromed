import { useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { BarRow, DayBars } from '../components/charts'
import { ErrorBox, ListSkeleton, pctText } from '../components/bits'
import { Card, EmptyState, LinkButton, Stat } from '../components/ui'
import { useCatalog, useQuestions } from '../data/ContentContext'
import { MIN_ANSWERS_FOR_WEAK, TREND_DAYS, WEAK_BELOW_PCT, buildAnalytics } from '../analytics/analytics'
import { useMock } from '../mock/store'
import { useAttempts } from '../practice/attempts'
import { configToParams } from '../practice/params'
import { DEFAULT_CONFIG } from '../practice/session'

const secs = (s: number | null) => (s === null ? '—' : `${Math.round(s)} s`)
const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function Analytics() {
  const { user } = useAuth()
  const attempts = useAttempts(user?.id)
  const mock = useMock(user?.id)
  const cat = useCatalog()
  const qs = useQuestions(null)

  const a = useMemo(
    () => (cat.status === 'ready' && qs.status === 'ready' ? buildAnalytics(attempts, qs.questions, cat.catalog.taxonomy.topics, cat.catalog.taxonomy.subjects, mock.results) : null),
    [cat, qs, attempts, mock.results],
  )

  if (cat.status === 'error') return <ErrorBox message={cat.error} onRetry={cat.retry} />
  if (qs.status === 'error') return <ErrorBox message={qs.error} onRetry={qs.retry} />
  if (!a || cat.status !== 'ready') return <ListSkeleton rows={4} />

  const subjectName = (id: string) => cat.catalog.taxonomy.subjects.find((s) => s.id === id)?.name ?? id
  const practiceLink = (subjectId: string, topicId: string) => `/app/practice?${configToParams({ ...DEFAULT_CONFIG, subjectId, topicId, mode: 'all' })}`
  const topicsWithAnswers = a.topics.filter((t) => t.answers > 0).sort((x, y) => (x.accuracyPct ?? 101) - (y.accuracyPct ?? 101) || x.name.localeCompare(y.name))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Performance intelligence</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1></div>
      <p className="text-sm text-muted">Worked out only from your own answers. These describe what you have done so far. They are not a prediction of any exam result.</p>

      {a.answers === 0 ? (
        <EmptyState title="Nothing to analyse yet" body="Answer some questions and your strengths and weak topics will appear here." action={<LinkButton to="/app/subjects">Choose a subject</LinkButton>} />
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Answers" value={String(a.answers)} />
            <Stat label="Accuracy" value={pctText(a.accuracyPct)} />
            <Stat label="Questions tried" value={String(a.distinctQuestions)} />
            <Stat label="Average time" value={secs(a.avgSeconds)} hint="per answer" />
          </section>

          <section aria-label="Weak topics" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold tracking-tight">Weak topics</h2>
            {a.weakTopics.length === 0 ? (
              <Card>
                <p>
                  {a.tooFewTopics > 0 && a.topics.every((t) => t.answers < MIN_ANSWERS_FOR_WEAK)
                    ? `Not enough answers yet. A topic needs at least ${MIN_ANSWERS_FOR_WEAK} answers before it can be called weak.`
                    : `No weak topics right now: every topic with at least ${MIN_ANSWERS_FOR_WEAK} answers is at ${WEAK_BELOW_PCT}% or better.`}
                </p>
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {a.weakTopics.map((t) => (
                  <li key={t.id}>
                    <Card className="flex flex-col gap-3">
                      <BarRow label={t.name} valuePct={t.accuracyPct} valueText={pctText(t.accuracyPct)} detail={`${subjectName(t.subjectId)} · ${plural(t.answers, 'answer', 'answers')} · ${t.correct} correct`} />
                      <div><LinkButton to={practiceLink(t.subjectId, t.id)} variant="secondary">Practise {t.name}</LinkButton></div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">Weak means accuracy below {WEAK_BELOW_PCT}% over at least {MIN_ANSWERS_FOR_WEAK} answers.{a.tooFewTopics > 0 ? ` ${plural(a.tooFewTopics, 'topic has', 'topics have')} too few answers to judge.` : ''}</p>
          </section>

          <section aria-label="By subject" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold tracking-tight">By subject</h2>
            <Card className="flex flex-col gap-4">
              {a.subjects.map((s) => (
                <BarRow key={s.id} label={s.name} valuePct={s.accuracyPct} valueText={pctText(s.accuracyPct)} detail={s.answers === 0 ? 'No answers yet' : `${plural(s.answers, 'answer', 'answers')} · ${s.attemptedQuestions} of ${s.questionCount} questions tried · mastery ${pctText(s.masteryPct)}`} />
              ))}
            </Card>
            <p className="text-xs text-muted">Mastery is the share of a subject's questions whose most recent answer was correct.</p>
          </section>

          {topicsWithAnswers.length > 0 ? (
            <section aria-label="By topic" className="flex flex-col gap-3">
              <h2 className="text-base font-semibold tracking-tight">By topic</h2>
              <Card className="flex flex-col gap-4">
                {topicsWithAnswers.map((t) => (
                  <BarRow key={t.id} label={t.name} valuePct={t.accuracyPct} valueText={pctText(t.accuracyPct)} detail={`${subjectName(t.subjectId)} · ${plural(t.answers, 'answer', 'answers')} · mastery ${pctText(t.masteryPct)}`} />
                ))}
              </Card>
            </section>
          ) : null}

          <section aria-label="Recent days" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Last {TREND_DAYS} days</h2>
            <Card>
              <DayBars
                caption={`Answers per day over the last ${TREND_DAYS} days`}
                bars={a.days.map((d) => ({ key: d.date, label: shortDay(d.date), value: d.answered, text: d.answered === 0 ? '0' : `${d.answered} (${d.correct} correct)` }))}
              />
            </Card>
          </section>

          <section aria-label="By difficulty" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">By difficulty</h2>
            <Card className="flex flex-col gap-4">
              {a.difficulty.map((d) => (
                <BarRow key={d.difficulty} label={d.difficulty[0].toUpperCase() + d.difficulty.slice(1)} valuePct={d.accuracyPct} valueText={pctText(d.accuracyPct)} detail={d.answers === 0 ? 'No answers yet' : plural(d.answers, 'answer', 'answers')} />
              ))}
            </Card>
          </section>

          <section aria-label="Confidence" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">How sure you were</h2>
            {a.ratedAnswers === 0 ? (
              <Card><p>You have not rated your confidence yet. Choose how sure you are before answering and this section will show whether your confidence matches your results.</p></Card>
            ) : (
              <Card className="flex flex-col gap-4">
                {a.confidence.map((c) => (
                  <BarRow key={c.rating} label={`Sure ${c.rating} of 5${c.rating === 1 ? ' (a guess)' : c.rating === 5 ? ' (certain)' : ''}`} valuePct={c.accuracyPct} valueText={pctText(c.accuracyPct)} detail={c.answers === 0 ? 'No answers' : `${plural(c.answers, 'answer', 'answers')} at this level`} />
                ))}
                <p className="text-sm">
                  {plural(a.sureButWrong, 'answer was', 'answers were')} wrong although you were sure (4 or 5), and {plural(a.unsureButRight, 'answer was', 'answers were')} right although you were unsure (1 or 2).
                </p>
              </Card>
            )}
          </section>

          <section aria-label="Time" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Time per answer</h2>
            <Card>
              <ul className="flex flex-col gap-1">
                {a.avgSecondsByMode.filter((m) => m.answers > 0).map((m) => (
                  <li key={m.mode} className="flex justify-between gap-3"><span>{m.mode[0].toUpperCase() + m.mode.slice(1)}</span><span className="tabular-nums">{secs(m.avgSeconds)} ({plural(m.answers, 'answer', 'answers')})</span></li>
                ))}
              </ul>
            </Card>
          </section>

          {a.mocks.length > 0 ? (
            <section aria-label="Mock exam scores" className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Mock exam scores</h2>
              <Card className="flex flex-col gap-4">
                {a.mocks.map((m) => (
                  <BarRow key={m.id} label={dateText(m.finishedAt)} valuePct={m.scorePct} valueText={`${Math.round(m.scorePct)}%`} detail={`${plural(m.total, 'question', 'questions')}`} />
                ))}
              </Card>
              <p className="text-xs text-muted">Your last {Math.min(10, a.mocks.length)} exams on this device, oldest first. Unanswered questions count as wrong.</p>
            </section>
          ) : null}
        </>
      )}
      {a.orphanedAnswers > 0 ? <p className="text-xs text-muted">{plural(a.orphanedAnswers, 'answer is', 'answers are')} for questions no longer in the question bank and {a.orphanedAnswers === 1 ? 'is' : 'are'} left out of these figures.</p> : null}
    </div>
  )
}
