import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { AuthShell, Field, Form, NotConfigured, Notice } from './AuthForm'
import { validateDisplayName, validateEmail, validatePassword } from './validation'

export function LoginPage() {
  const auth = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!auth.configured) return <NotConfigured />
  if (!auth.loading && auth.session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from.startsWith('/app') ? from : '/app'} replace />
  }

  async function submit() {
    const e = { email: validateEmail(email), password: password ? null : 'Enter your password.' }
    setErrors(e)
    setFormError(null)
    if (e.email || e.password) return
    setSubmitting(true)
    const { error } = await auth.signIn(email, password)
    setSubmitting(false)
    if (error) setFormError(error)
  }

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          New here? <Link to="/signup" className="font-semibold text-brand underline">Create an account</Link>
        </>
      }
    >
      <Form onSubmit={submit} submitting={submitting} submitLabel="Sign in" formError={formError}>
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" error={errors.email} />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" error={errors.password} />
        <Link to="/forgot-password" className="text-sm font-semibold text-brand underline">
          Forgot your password?
        </Link>
      </Form>
    </AuthShell>
  )
}

export function SignupPage() {
  const auth = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string | null; email?: string | null; password?: string | null }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (!auth.configured) return <NotConfigured />
  if (!auth.loading && auth.session) return <Navigate to="/app" replace />

  async function submit() {
    const e = { name: validateDisplayName(name), email: validateEmail(email), password: validatePassword(password) }
    setErrors(e)
    setFormError(null)
    if (e.name || e.email || e.password) return
    setSubmitting(true)
    const res = await auth.signUp(email, password, name)
    setSubmitting(false)
    if (res.error) return setFormError(res.error)
    if (res.needsConfirmation) setSentTo(email.trim())
    // Otherwise a session now exists and the redirect above takes over.
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/login" className="font-semibold text-brand underline">Back to sign in</Link>}>
        <Notice>
          If <strong>{sentTo}</strong> can be registered, we have sent a confirmation link. Open it, then sign in.
          It can take a few minutes. Check your spam folder too.
        </Notice>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      footer={
        <>
          Already registered? <Link to="/login" className="font-semibold text-brand underline">Sign in</Link>
        </>
      }
    >
      <Form onSubmit={submit} submitting={submitting} submitLabel="Create account" formError={formError}>
        <Field label="Name (optional)" value={name} onChange={setName} autoComplete="name" error={errors.name} />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" error={errors.email} />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
          hint="At least 8 characters."
        />
        <p className="text-sm text-muted">
          Educational use only. Never enter patient-identifiable information anywhere in the app.
        </p>
      </Form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (!auth.configured) return <NotConfigured />

  async function submit() {
    const e = validateEmail(email)
    setError(e)
    setFormError(null)
    if (e) return
    setSubmitting(true)
    const res = await auth.requestPasswordReset(email)
    setSubmitting(false)
    if (res.error) return setFormError(res.error)
    setDone(true)
  }

  return (
    <AuthShell title="Reset your password" footer={<Link to="/login" className="font-semibold text-brand underline">Back to sign in</Link>}>
      {done ? (
        <Notice>If an account exists for {email.trim()}, a reset link is on its way.</Notice>
      ) : (
        <Form onSubmit={submit} submitting={submitting} submitLabel="Send reset link" formError={formError}>
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" error={error} />
        </Form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (!auth.configured) return <NotConfigured />
  if (auth.loading) return <AuthShell title="Reset your password"><p role="status">Checking your link…</p></AuthShell>

  if (done) {
    return (
      <AuthShell title="Password updated" footer={<Link to="/app" className="font-semibold text-brand underline">Continue to the app</Link>}>
        <Notice>Your password has been changed.</Notice>
      </AuthShell>
    )
  }

  if (!auth.recovery) {
    return (
      <AuthShell title="Link expired" footer={<Link to="/forgot-password" className="font-semibold text-brand underline">Request a new link</Link>}>
        <p>This reset link is invalid or has expired.</p>
      </AuthShell>
    )
  }

  async function submit() {
    const e = {
      password: validatePassword(password),
      confirm: password === confirm ? null : 'The passwords do not match.',
    }
    setErrors(e)
    setFormError(null)
    if (e.password || e.confirm) return
    setSubmitting(true)
    const res = await auth.setNewPassword(password)
    setSubmitting(false)
    if (res.error) return setFormError(res.error)
    setDone(true)
  }

  return (
    <AuthShell title="Choose a new password">
      <Form onSubmit={submit} submitting={submitting} submitLabel="Update password" formError={formError}>
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" error={errors.password} hint="At least 8 characters." />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={errors.confirm} />
      </Form>
    </AuthShell>
  )
}
