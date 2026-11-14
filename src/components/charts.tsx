import type { ReactNode } from 'react'

/** Compact visual comparison; the exact value remains visible as text. */
export function BarRow({ label, valuePct, valueText, detail }: { label: ReactNode; valuePct: number | null; valueText: string; detail?: string }) {
  const w = valuePct === null ? 0 : Math.max(0, Math.min(100, valuePct))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold">{label}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums">{valueText}</span>
      </div>
      <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand/65 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${w}%` }} />
      </div>
      {detail ? <span className="text-xs leading-5 text-muted">{detail}</span> : null}
    </div>
  )
}

export interface DayBar {
  key: string
  label: string
  value: number
  text: string
}

/** Accessible activity chart: visual bars plus a complete data table. */
export function DayBars({ bars, caption }: { bars: DayBar[]; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <div>
      <div
        role="img"
        aria-label={`${caption}: ${bars.map((b) => `${b.label}, ${b.text}`).join('; ')}`}
        className="relative grid h-36 grid-cols-[repeat(var(--bar-count),minmax(0,1fr))] items-end gap-1.5 rounded-xl bg-bg/70 px-2 pb-2 pt-3 sm:gap-2 sm:px-3"
        style={{ '--bar-count': Math.max(1, bars.length) } as React.CSSProperties}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-1/4 border-t border-dashed border-line/70" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-2/4 border-t border-dashed border-line/70" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-3/4 border-t border-dashed border-line/70" />
        {bars.map((b) => (
          <div key={b.key} className="relative z-[1] flex h-full min-w-0 items-end justify-center">
            <div
              title={`${b.label}: ${b.text}`}
              className="w-full max-w-8 rounded-t-md bg-gradient-to-t from-brand to-brand/55 transition-[height] duration-500 motion-reduce:transition-none"
              style={{ height: `${b.value === 0 ? 2 : Math.max(5, (b.value / max) * 100)}%`, opacity: b.value === 0 ? 0.18 : 1 }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-between px-1 text-[10px] font-medium text-muted">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-muted transition-colors hover:text-ink">View exact activity data</summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col" className="py-2 pr-2 text-xs font-semibold text-muted">Day</th><th scope="col" className="py-2 text-xs font-semibold text-muted">Answers</th></tr></thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key} className="border-t border-line"><th scope="row" className="py-2 pr-2 font-medium">{b.label}</th><td className="py-2 tabular-nums">{b.text}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
