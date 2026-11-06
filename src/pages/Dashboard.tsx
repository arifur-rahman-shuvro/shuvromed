import { EmptyState, LinkButton, Stat } from '../components/ui'
import { formatAccuracy, getDashboardStats } from '../lib/stats'

export default function Dashboard() {
  const s = getDashboardStats()
  const pct = Math.min(100, Math.round((s.answeredToday / s.dailyGoal) * 100))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section aria-label="Daily goal" className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Daily goal</h2>
          <p className="text-sm text-muted">
            {s.answeredToday} / {s.dailyGoal} questions
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Daily goal progress"
          className="mt-3 h-3 overflow-hidden rounded-full bg-surface2"
        >
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section aria-label="Statistics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Streak" value={`${s.streakDays} days`} />
        <Stat label="XP / Level" value={`${s.xp} XP`} hint={`Level ${s.level}`} />
        <Stat label="Attempted" value={String(s.attempted)} />
        <Stat label="Accuracy" value={formatAccuracy(s.accuracyPct)} />
        <Stat label="Study time today" value={`${s.studyMinutesToday} min`} />
        <Stat label="Due revisions" value={String(s.dueRevisions)} />
      </section>

      <div className="flex flex-wrap gap-3">
        <LinkButton to="/app/subjects">Browse subjects</LinkButton>
        <LinkButton to="/app/subjects" variant="secondary">
          Quick practice
        </LinkButton>
      </div>

      <EmptyState
        title="No activity yet"
        body="Questions you answer will appear here, along with your weak topics and recent activity. Numbers on this page come only from your own attempts."
      />
    </div>
  )
}
