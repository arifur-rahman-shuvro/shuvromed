import { useId, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui'

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <Link to="/" className="text-center text-xl font-bold">
        ShuvroMed
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="mb-4 text-2xl font-bold">{title}</h1>
        {children}
      </div>
      {footer ? <div className="text-center text-sm text-muted">{footer}</div> : null}
    </main>
  )
}

export function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  hint,
}: {
  label: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (v: string) => void
  autoComplete: string
  error?: string | null
  hint?: string
}) {
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={type === 'email' ? 'email' : undefined}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-12 rounded-xl border border-line bg-bg px-3 text-base"
      />
      {error ? (
        <p id={`${id}-err`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Form({
  onSubmit,
  submitting,
  submitLabel,
  formError,
  children,
}: {
  onSubmit: () => void
  submitting: boolean
  submitLabel: string
  formError: string | null
  children: ReactNode
}) {
  function handle(e: FormEvent) {
    e.preventDefault()
    if (!submitting) onSubmit()
  }
  return (
    <form onSubmit={handle} noValidate className="flex flex-col gap-4">
      {children}
      <p role="alert" aria-live="assertive" className={formError ? 'text-danger' : 'sr-only'}>
        {formError ?? ''}
      </p>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Please wait…' : submitLabel}
      </Button>
    </form>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-line bg-surface2 p-4">
      {children}
    </div>
  )
}

export function NotConfigured() {
  return (
    <AuthShell title="Not configured">
      <p role="alert" className="text-danger">
        This copy of the app has no Supabase connection settings, so sign-in is unavailable. The site owner needs
        to set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
      </p>
    </AuthShell>
  )
}
