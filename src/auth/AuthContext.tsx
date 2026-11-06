import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** The slice of supabase.auth we use. Lets tests inject a stand-in client. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signUp' | 'signInWithPassword' | 'signOut' | 'resetPasswordForEmail' | 'updateUser'
>

export type ActionResult = { error: string | null }
export type SignUpResult = ActionResult & { needsConfirmation: boolean }

export interface AuthState {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  /** True after the user opened a password-reset link; they may now choose a new password. */
  recovery: boolean
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpResult>
  signIn: (email: string, password: string) => Promise<ActionResult>
  signOut: () => Promise<ActionResult>
  requestPasswordReset: (email: string) => Promise<ActionResult>
  setNewPassword: (password: string) => Promise<ActionResult>
}

const AuthContext = createContext<AuthState | null>(null)

/** Turn provider errors into messages that are useful but do not reveal whether an email exists. */
export function friendlyAuthError(err: { message?: string; code?: string; status?: number } | null): string | null {
  if (!err) return null
  const code = err.code ?? ''
  const msg = (err.message ?? '').toLowerCase()
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Incorrect email or password.'
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Please confirm your email first. Check your inbox for the link.'
  if (code === 'weak_password' || msg.includes('password should')) return 'That password is too weak. Try a longer one.'
  if (code === 'same_password') return 'Choose a password different from your current one.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429)
    return 'Too many attempts right now. Please wait a few minutes and try again.'
  if (code === 'user_already_exists') return 'We could not create that account. Try signing in instead.'
  if (msg.includes('fetch') || msg.includes('network')) return 'Network problem. Check your connection and try again.'
  return 'Something went wrong. Please try again.'
}

export function AuthProvider({ client, children }: { client: AuthClient | null; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(client))
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    if (!client) return
    let active = true
    client
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
      })
      .catch(() => {
        /* treat as signed out; the page will show the sign-in form */
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    // Keep this callback synchronous: calling back into supabase here can deadlock.
    const { data } = client.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
      setLoading(false)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client])

  const signUp = useCallback<AuthState['signUp']>(
    async (email, password, displayName) => {
      if (!client) return { error: 'The app is not configured.', needsConfirmation: false }
      const { data, error } = await client.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      })
      if (error) return { error: friendlyAuthError(error), needsConfirmation: false }
      // No session means email confirmation is on. Same wording whether or not the email already existed.
      return { error: null, needsConfirmation: !data.session }
    },
    [client],
  )

  const signIn = useCallback<AuthState['signIn']>(
    async (email, password) => {
      if (!client) return { error: 'The app is not configured.' }
      const { error } = await client.signInWithPassword({ email: email.trim(), password })
      return { error: friendlyAuthError(error) }
    },
    [client],
  )

  const signOut = useCallback<AuthState['signOut']>(async () => {
    if (!client) return { error: null }
    const { error } = await client.signOut()
    return { error: friendlyAuthError(error) }
  }, [client])

  const requestPasswordReset = useCallback<AuthState['requestPasswordReset']>(
    async (email) => {
      if (!client) return { error: 'The app is not configured.' }
      const { error } = await client.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      return { error: friendlyAuthError(error) }
    },
    [client],
  )

  const setNewPassword = useCallback<AuthState['setNewPassword']>(
    async (password) => {
      if (!client) return { error: 'The app is not configured.' }
      const { error } = await client.updateUser({ password })
      if (!error) setRecovery(false)
      return { error: friendlyAuthError(error) }
    },
    [client],
  )

  const value = useMemo<AuthState>(
    () => ({
      configured: Boolean(client),
      loading,
      session,
      user: session?.user ?? null,
      recovery,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      setNewPassword,
    }),
    [client, loading, session, recovery, signUp, signIn, signOut, requestPasswordReset, setNewPassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
