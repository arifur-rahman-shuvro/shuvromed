import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50'
const variants = {
  primary: 'bg-brand text-brandfg shadow-sm hover:brightness-95 active:brightness-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface2 active:bg-surface2',
  ghost: 'text-ink hover:bg-surface2 active:bg-surface2',
}
type Variant = keyof typeof variants

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function LinkButton({ variant = 'primary', className = '', ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`group relative rounded-[var(--radius-card)] border border-line/90 bg-surface p-4 shadow-[var(--shadow-soft)] transition-[border-color,box-shadow,transform] duration-200 hover:border-brand/25 hover:shadow-[var(--shadow-hover)] sm:p-5 motion-reduce:transition-none ${className}`}>
      {children}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-surface2 motion-reduce:animate-none ${className}`} />
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center">
      <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl border border-brand/15 bg-brand/10 text-xl text-brand shadow-sm">✳</span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-md text-sm leading-6 text-muted">{body}</p>
      {action}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="overflow-hidden">
      <div aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-brand/65" />
      <p className="text-xs font-semibold tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-[1.75rem] font-bold leading-none tracking-tight tabular-nums sm:text-3xl">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-5 text-muted">{hint}</p> : <div className="mt-2 h-5" />}
      <div aria-hidden="true" className="pointer-events-none absolute -right-5 -top-7 size-20 rounded-full border-[10px] border-brand/[0.045]" />
    </Card>
  )
}
