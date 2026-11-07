import type { ReactNode } from 'react'

/**
 * Small charts built from plain elements. The numbers are always printed as text beside or inside the
 * graphic (the bars are decoration for sighted users), one hue only, so nothing relies on colour.
 */
export function BarRow({ label, valuePct, valueText, detail }: { label: ReactNode; valuePct: number | null; valueText: string; detail?: string }) {
  const w = valuePct === null ? 0 : Math.max(0, Math.min(100, valuePct))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{valueText}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full bg-brand" style={{ width: `${w}%` }} />
      </div>
      {detail ? <span className="text-xs text-muted">{detail}</span> : null}
    </div>
  )
}

export interface DayBar {
  key: string
  label: string
  value: number
  text: string
}

/** One bar per day, scaled to the busiest day. The table underneath the graphic holds the same numbers. */
export function DayBars({ bars, caption }: { bars: DayBar[]; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <div>
      <div aria-hidden="true" className="flex h-24 items-end gap-1">
        {bars.map((b) => (
          <div key={b.key} className="flex h-full flex-1 items-end">
            <div className="w-full rounded-t-sm bg-brand" style={{ height: `${b.value === 0 ? 0 : Math.max(4, (b.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-muted">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
      <details className="mt-2">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">View as a table</summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr><th scope="col" className="py-1 pr-2">Day</th><th scope="col" className="py-1">Answers</th></tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key} className="border-t border-line"><th scope="row" className="py-1 pr-2 font-normal">{b.label}</th><td className="py-1 tabular-nums">{b.text}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
