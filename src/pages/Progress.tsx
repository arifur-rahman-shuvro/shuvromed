import { dayCount } from '../lib/days'
import { useAuth } from '../auth/AuthContext'
import { Badge } from '../components/bits'
import { Card, Stat } from '../components/ui'
import { BADGES, XP_RULES, buildProgress, xpForLevel } from '../gamification/progress'
import { setGamification, useGamification } from '../gamification/pref'
import { useAttempts } from '../practice/attempts'

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export default function Progress() {
  const { user } = useAuth()
  const attempts = useAttempts(user?.id)
  const on = useGamification(user?.id)
  const p = buildProgress(attempts)
  const pct = p.level.span === 0 ? 0 : Math.round((p.level.into / p.level.span) * 100)
  const earned = p.badges.filter((b) => b.earnedAt)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Learning overview</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Progress</h1></div>

      <Card className="flex flex-col gap-2">
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="size-5" checked={on} onChange={(e) => user && setGamification(user.id, e.target.checked)} />
          Show XP, levels and badges
        </label>
        <p className="text-sm text-muted">Turning this off hides XP, levels and badges on this device. Your streak and study numbers stay visible.</p>
      </Card>

      <section aria-label="Streak" className="grid grid-cols-2 gap-3">
        <Stat label="Current streak" value={dayCount(p.streakDays)} hint="A day counts when you answer at least one question" />
        <Stat label="Longest streak" value={dayCount(p.longestStreakDays)} />
      </section>

      {on ? (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">Level {p.level.level}</h2>
              <p className="text-muted" data-testid="xp-total">{p.xp} XP</p>
            </div>
            <div role="progressbar" aria-label="Progress to next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-3 overflow-hidden rounded-full bg-surface2">
              <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-muted">{p.level.span - p.level.into} XP to level {p.level.level + 1} (needs {xpForLevel(p.level.level + 1)} XP in total).</p>
          </Card>

          <section aria-label="Badges" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Badges ({earned.length} of {BADGES.length})</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {p.badges.map((b) => (
                <li key={b.id}>
                  <Card className={`flex flex-col gap-1 ${b.earnedAt ? '' : 'border-dashed'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <strong>{b.name}</strong>
                      <Badge tone={b.earnedAt ? 'good' : 'neutral'}>{b.earnedAt ? `Earned ${dateText(b.earnedAt)}` : 'Locked'}</Badge>
                    </div>
                    <p className="text-sm text-muted">{b.how}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <Card>
            <h2 className="mb-2 font-semibold">How XP works</h2>
            <ul className="list-disc pl-5 text-sm">
              <li>Practice and revision: {XP_RULES.practiceCorrect} XP for a correct answer, {XP_RULES.practiceWrong} XP for a wrong one.</li>
              <li>Mock exam: {XP_RULES.mockCorrect} XP for a correct answer, {XP_RULES.mockWrong} XP for a wrong one.</li>
              <li>Only the first answer to a question each day earns XP, so repeating one question cannot farm points.</li>
              <li>XP is worked out from your answer history, so it is the same on every device.</li>
            </ul>
          </Card>
        </>
      ) : (
        <p className="text-muted">XP, levels and badges are hidden. Turn the switch on above to see them again.</p>
      )}
    </div>
  )
}
