/** Local calendar date as YYYY-MM-DD (the student's own day, not UTC). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + delta))
}

/**
 * Consecutive days with at least one answer. A streak is still alive if the last study day was
 * yesterday (today is not over yet); it is 0 once a full day has been missed.
 */
export function computeStreak(days: ReadonlySet<string>, today: string): number {
  let cursor = days.has(today) ? today : shiftDay(today, -1)
  let n = 0
  while (days.has(cursor)) {
    n += 1
    cursor = shiftDay(cursor, -1)
  }
  return n
}


/** '1 day', '3 days' */
export const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
