import { LinkButton } from '../components/ui'

export default function AuthPlaceholder({ mode }: { mode: 'login' | 'signup' }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <p className="text-muted">
        Accounts arrive in Phase 2 (Supabase auth). Until then you can preview the app without
        signing in.
      </p>
      <LinkButton to="/app">Preview the app</LinkButton>
      <LinkButton to="/" variant="ghost">
        Back to home
      </LinkButton>
    </div>
  )
}
