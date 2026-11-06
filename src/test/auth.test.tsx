import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { friendlyAuthError } from '../auth/AuthContext'
import { validateDisplayName, validateEmail, validatePassword } from '../auth/validation'
import { makeFakeAuth } from './fakeAuthClient'
import { renderApp } from './utils'

const signedOut = (o = {}) => makeFakeAuth({ users: { 'me@test.local': 'correct-horse' }, ...o })

describe('validation', () => {
  it('validates emails', () => {
    expect(validateEmail('')).toMatch(/Enter your email/)
    expect(validateEmail('nope')).toMatch(/valid email/)
    expect(validateEmail('a@b')).toMatch(/valid email/)
    expect(validateEmail(' me@test.local ')).toBeNull()
  })
  it('validates passwords (8 to 72 characters)', () => {
    expect(validatePassword('short')).toMatch(/at least 8/)
    expect(validatePassword('x'.repeat(73))).toMatch(/at most 72/)
    expect(validatePassword('longenough')).toBeNull()
  })
  it('limits the display name', () => {
    expect(validateDisplayName('x'.repeat(81))).not.toBeNull()
    expect(validateDisplayName('Dr Who')).toBeNull()
  })
  it('maps provider errors to safe, friendly messages', () => {
    expect(friendlyAuthError(null)).toBeNull()
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Incorrect email or password.')
    expect(friendlyAuthError({ message: 'Email not confirmed' })).toMatch(/confirm your email/i)
    expect(friendlyAuthError({ status: 429 })).toMatch(/Too many attempts/)
    expect(friendlyAuthError({ message: 'Failed to fetch' })).toMatch(/Network/)
    // Unknown internals are never echoed to the user.
    expect(friendlyAuthError({ message: 'pg: relation "secret" does not exist' })).toBe('Something went wrong. Please try again.')
  })
})

describe('route protection and session persistence', () => {
  it('sends a signed-out visitor from /app to sign-in', async () => {
    renderApp('/app', signedOut())
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('protects every /app section, not just the dashboard', async () => {
    for (const p of ['/app/subjects', '/app/revision', '/app/mock', '/app/analytics', '/app/settings']) {
      const { unmount } = renderApp(p, signedOut())
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      unmount()
    }
  })

  it('restores an existing session on load (simulates a page reload)', async () => {
    renderApp('/app', makeFakeAuth({ signedInAs: 'me@test.local' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('me@test.local')).toBeInTheDocument()
  })

  it('redirects an already signed-in user away from the sign-in page', async () => {
    renderApp('/login', makeFakeAuth({ signedInAs: 'me@test.local' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('sign in', () => {
  it('signs in with correct credentials and lands on the dashboard', async () => {
    const fake = signedOut()
    renderApp('/login', fake)
    await userEvent.type(await screen.findByLabelText('Email'), 'me@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(fake.calls.signIn).toHaveLength(1)
  })

  it('returns to the page the user originally asked for', async () => {
    const fake = signedOut()
    renderApp('/app/revision', fake)
    await userEvent.type(await screen.findByLabelText('Email'), 'me@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Revision' })).toBeInTheDocument()
  })

  it('shows a generic error for a wrong password and stays on the form', async () => {
    renderApp('/login', signedOut())
    await userEvent.type(await screen.findByLabelText('Email'), 'me@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('explains an unconfirmed email', async () => {
    renderApp('/login', signedOut({ users: { 'new@test.local': 'password123' }, unconfirmed: ['new@test.local'] }))
    await userEvent.type(await screen.findByLabelText('Email'), 'new@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your email/i)
  })

  it('validates empty and malformed input without calling the server', async () => {
    const fake = signedOut()
    renderApp('/login', fake)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(fake.calls.signIn).toHaveLength(0)
  })
})

describe('sign up', () => {
  it('registers, sends the display name and redirect, and asks the user to confirm email', async () => {
    const fake = signedOut()
    renderApp('/signup', fake)
    await userEvent.type(await screen.findByLabelText(/Name/), '  Dr Shuvro ')
    await userEvent.type(screen.getByLabelText('Email'), 'new@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('new@test.local')).toBeInTheDocument()
    const sent = fake.calls.signUp[0] as { email: string; options: { data: { display_name: string }; emailRedirectTo: string } }
    expect(sent.email).toBe('new@test.local')
    expect(sent.options.data.display_name).toBe('Dr Shuvro')
    expect(sent.options.emailRedirectTo).toMatch(/\/login$/)
  })

  it('gives the same answer for an email that is already registered (no account enumeration)', async () => {
    renderApp('/signup', signedOut())
    await userEvent.type(await screen.findByLabelText('Email'), 'me@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'another-password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
  })

  it('goes straight in when the project does not require email confirmation', async () => {
    renderApp('/signup', signedOut({ confirmEmail: false }))
    await userEvent.type(await screen.findByLabelText('Email'), 'fresh@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-password')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('rejects a short password without calling the server', async () => {
    const fake = signedOut()
    renderApp('/signup', fake)
    await userEvent.type(await screen.findByLabelText('Email'), 'new@test.local')
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(fake.calls.signUp).toHaveLength(0)
  })
})

describe('password reset', () => {
  it('requests a reset link without revealing whether the account exists', async () => {
    const fake = signedOut()
    renderApp('/forgot-password', fake)
    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@test.local')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/If an account exists/)
    const call = fake.calls.reset[0] as { email: string; options: { redirectTo: string } }
    expect(call.email).toBe('nobody@test.local')
    expect(call.options.redirectTo).toMatch(/\/reset-password$/)
  })

  it('shows "link expired" when the page is opened without a recovery link', async () => {
    renderApp('/reset-password', signedOut())
    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument()
  })

  it('lets the user choose a new password after opening the emailed link', async () => {
    const fake = signedOut()
    renderApp('/reset-password', fake)
    await screen.findByRole('heading', { name: 'Link expired' })
    fake.openRecoveryLink('me@test.local')
    await userEvent.type(await screen.findByLabelText('New password'), 'brand-new-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-password')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
    expect(fake.calls.updateUser).toEqual([{ password: 'brand-new-password' }])
  })

  it('refuses mismatched passwords', async () => {
    const fake = signedOut()
    renderApp('/reset-password', fake)
    await screen.findByRole('heading', { name: 'Link expired' })
    fake.openRecoveryLink('me@test.local')
    await userEvent.type(await screen.findByLabelText('New password'), 'brand-new-password')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument()
    expect(fake.calls.updateUser).toHaveLength(0)
  })
})

describe('sign out', () => {
  it('signs out, returns to the landing page, and /app is protected again', async () => {
    const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
    const { router } = renderApp('/app', fake)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(fake.calls.signOut).toBe(1)
    await router.navigate('/app')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('missing configuration', () => {
  it('shows a clear message instead of crashing when Supabase env vars are absent', async () => {
    renderApp('/login', makeFakeAuth(), null)
    expect(await screen.findByRole('alert')).toHaveTextContent(/no Supabase connection settings/)
  })

  it('does not let anyone into /app when auth is not configured', async () => {
    renderApp('/app', makeFakeAuth(), null)
    expect(await screen.findByRole('alert')).toHaveTextContent(/no Supabase connection settings/)
  })
})
