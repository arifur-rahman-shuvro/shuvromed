import { dayCount } from '../lib/days'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, LinkButton, Stat } from '../components/ui'
import { useAttempts } from '../practice/attempts'
import { useGamification } from '../gamification/pref'
import { useDailyGoal } from '../prefs/settings'
import { buildSchedule, dueQuestions } from '../practice/srs'
import { formatAccuracy, getDashboardStats } from '../lib/stats'

export default function Dashboard() {
  const { user } = useAuth()
  const attempts = useAttempts(user?.id)
  const showXp = useGamification(user?.id)
  const goal = useDailyGoal(user?.id)
  const s = getDashboardStats(attempts, new Date(), goal)
  const due = dueQuestions(buildSchedule(attempts)).length
  const pct = Math.min(100, Math.round((s.answeredToday / s.dailyGoal) * 100))

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Your learning workspace</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Good to see you</h1></div>

      <section aria-label="Daily goal" className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold tracking-tight">Daily goal</h2>
          <p className="text-sm text-muted">
            {s.answeredToday} / {s.dailyGoal} questions
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${s.answeredToday} of ${s.dailyGoal} questions completed`}
          aria-label="Daily goal progress"
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-surface2"
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Streak" value={dayCount(s.streakDays)} />
        {showXp ? <Stat label="XP / Level" value={`${s.xp} XP · L${s.level}`} hint="Open Progress for badges" /> : null}
        <Stat label="Answers recorded" value={String(s.attempted)} hint="On this device" />
        <Stat label="Accuracy" value={formatAccuracy(s.accuracyPct)} />
        <Stat label="Study time today" value={`${s.studyMinutesToday} min`} />
        <Stat label="Due revisions" value={String(due)} hint="Open Revision to study them" />
      </section>

      <div className="flex flex-wrap gap-3">
        <LinkButton to="/app/subjects">Browse subjects</LinkButton>
        <LinkButton to="/app/practice" variant="secondary">
          Quick practice
        </LinkButton>
        <LinkButton to="/app/revision" variant="secondary">
          Revision ({due} due)
        </LinkButton>
        <LinkButton to="/app/bookmarks" variant="secondary">
          Bookmarks
        </LinkButton>
        <LinkButton to="/app/notebook" variant="secondary">
          Notebook
        </LinkButton>
        <LinkButton to="/app/mock" variant="secondary">
          Mock exam
        </LinkButton>
        <LinkButton to="/app/progress" variant="secondary">
          Progress
        </LinkButton>
      </div>

      {s.recentDays.length === 0 ? (
        <EmptyState
          title="No activity yet"
          body="Questions you answer will appear here. Numbers on this page come only from your own answers."
        />
      ) : (
        <section aria-label="Recent activity" className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-base font-semibold tracking-tight">Recent activity</h2>
          <ul className="flex flex-col gap-1">
            {s.recentDays.map((d) => (
              <li key={d.date} className="flex justify-between gap-3">
                <span>{d.date}</span>
                <span className="text-muted">
                  {d.answered} answered · {d.correct} correct
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
