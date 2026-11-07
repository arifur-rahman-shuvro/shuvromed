import { useState, type ReactNode } from 'react'
import { Button, Skeleton } from './ui'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'demo' | 'good' | 'bad' }) {
  const tones = {
    neutral: 'bg-surface2 text-ink',
    demo: 'border border-accent text-accent',
    good: 'border border-success text-success',
    bad: 'border border-danger text-danger',
  }
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-danger p-4">
      <p className="font-semibold text-danger">Something went wrong</p>
      <p className="text-muted">{message}</p>
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
    </div>
  )
}

export function DemoBanner() {
  return (
    <p className="rounded-xl border border-accent p-3 text-sm">
      <strong>DEMO content.</strong> The questions here are a small set of unreviewed samples for testing the app. They are not
      exam material and the question bank is not complete.
    </p>
  )
}

export function pctText(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`
}

/**
 * A number box that can be emptied and retyped on a phone. The value is only tidied (clamped) once the
 * student leaves the box; while typing, what they typed stays on screen and the clamped number is passed on.
 */
export function CountInput({ id, value, max, className, onValue }: { id: string; value: number; max: number; className?: string; onValue: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      className={className}
      value={text ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw !== '' && Number.isFinite(Number(raw))) onValue(Number(raw))
      }}
      onBlur={() => setText(null)}
    />
  )
}
