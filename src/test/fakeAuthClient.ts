import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { AuthClient } from '../auth/AuthContext'

/**
 * TEST DOUBLE for supabase.auth: an in-memory stand-in so UI logic (forms, guards,
 * redirects, error messages) can be tested. It does NOT prove the real Supabase Auth
 * service works; that is checked separately against the real project.
 */
export interface FakeAuth {
  client: AuthClient
  calls: { signUp: unknown[]; signIn: unknown[]; reset: unknown[]; updateUser: unknown[]; signOut: number }
  /** Simulates opening the emailed reset link. */
  openRecoveryLink(email: string): void
}

type Opts = {
  signedInAs?: string
  confirmEmail?: boolean
  users?: Record<string, string>
  unconfirmed?: string[]
}

const mkSession = (email: string): Session =>
  ({ access_token: 't', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: `id-${email}`, email } }) as unknown as Session

export function makeFakeAuth(opts: Opts = {}): FakeAuth {
  const users: Record<string, string> = { ...(opts.users ?? {}) }
  let session: Session | null = opts.signedInAs ? mkSession(opts.signedInAs) : null
  const listeners = new Set<(e: AuthChangeEvent, s: Session | null) => void>()
  const emit = (e: AuthChangeEvent) => listeners.forEach((l) => l(e, session))
  const calls: FakeAuth['calls'] = { signUp: [], signIn: [], reset: [], updateUser: [], signOut: 0 }

  const client = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (cb: (e: AuthChangeEvent, s: Session | null) => void) => {
      listeners.add(cb)
      return { data: { subscription: { id: 'x', callback: cb, unsubscribe: () => listeners.delete(cb) } } }
    },
    signUp: async (args: { email: string; password: string; options?: unknown }) => {
      calls.signUp.push(args)
      // Real Supabase does not reveal whether the email already exists.
      if (!(args.email in users)) users[args.email] = args.password
      if (opts.confirmEmail ?? true) return { data: { user: { id: 'u' }, session: null }, error: null }
      session = mkSession(args.email)
      emit('SIGNED_IN')
      return { data: { user: session.user, session }, error: null }
    },
    signInWithPassword: async (args: { email: string; password: string }) => {
      calls.signIn.push(args)
      if (opts.unconfirmed?.includes(args.email))
        return { data: { user: null, session: null }, error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 } }
      if (users[args.email] !== args.password)
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }
      session = mkSession(args.email)
      emit('SIGNED_IN')
      return { data: { user: session.user, session }, error: null }
    },
    signOut: async () => {
      calls.signOut++
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    },
    resetPasswordForEmail: async (email: string, options?: unknown) => {
      calls.reset.push({ email, options })
      return { data: {}, error: null }
    },
    updateUser: async (attrs: { password?: string }) => {
      calls.updateUser.push(attrs)
      if (!session) return { data: { user: null }, error: { message: 'Auth session missing', status: 400 } }
      if ((attrs.password ?? '').length < 6)
        return { data: { user: null }, error: { message: 'Password should be at least 6 characters', code: 'weak_password', status: 422 } }
      users[session.user.email as string] = attrs.password as string
      return { data: { user: session.user }, error: null }
    },
  }

  return {
    client: client as unknown as AuthClient,
    calls,
    openRecoveryLink(email: string) {
      session = mkSession(email)
      emit('PASSWORD_RECOVERY')
    },
  }
}
