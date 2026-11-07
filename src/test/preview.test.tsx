import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../App'
import { AuthProvider, friendlyAuthError, useAuth, type AuthClient } from '../auth/AuthContext'
import PreviewBanner from '../components/PreviewBanner'
import { ContentClientContext } from '../data/ContentContext'
import { appUrl, assetUrl, basePath, routerBasename } from '../lib/appUrl'
import { makeFakeAuth } from './fakeAuthClient'
import { realContentClient } from './utils'

afterEach(() => vi.unstubAllEnvs())

describe('base-aware URLs', () => {
  it('works at the site root', () => {
    expect(basePath('/')).toBe('')
    expect(routerBasename('/')).toBe('/')
    expect(appUrl('/login', 'https://x.pages.dev', '/')).toBe('https://x.pages.dev/login')
    expect(assetUrl('content/manifest.json', '/')).toBe('/content/manifest.json')
  })
  it('works under a sub-path such as a GitHub Pages preview', () => {
    expect(basePath('/shuvromed/')).toBe('/shuvromed')
    expect(routerBasename('/shuvromed/')).toBe('/shuvromed')
    expect(appUrl('/login', 'https://user.github.io', '/shuvromed/')).toBe('https://user.github.io/shuvromed/login')
    expect(appUrl('reset-password', 'https://user.github.io/', '/shuvromed/')).toBe('https://user.github.io/shuvromed/reset-password')
    expect(assetUrl('/content/questions/anatomy.json', '/shuvromed/')).toBe('/shuvromed/content/questions/anatomy.json')
  })
})

describe('auth redirect URLs sent to Supabase', () => {
  it('signUp and password reset use the app URL, not a hard-coded root path', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    const client = {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signUp, resetPasswordForEmail,
    } as unknown as AuthClient
    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider client={client}>{children}</AuthProvider> })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const r = await result.current.signUp('a@b.co', 'password123', 'A')
    expect(r).toEqual({ error: null, needsConfirmation: true })
    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/login`)
    await result.current.requestPasswordReset('a@b.co')
    expect(resetPasswordForEmail.mock.calls[0][1].redirectTo).toBe(`${window.location.origin}/reset-password`)
  })
})

describe('friendly auth errors for a real test', () => {
  it('explains the built-in email restriction instead of "something went wrong"', () => {
    const m = friendlyAuthError({ code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' })!
    expect(m).toMatch(/only the project team/i)
    expect(m).not.toMatch(/something went wrong/i)
  })
  it('separates the hourly email limit from general rate limiting', () => {
    expect(friendlyAuthError({ code: 'over_email_send_rate_limit', status: 429 })).toMatch(/about an hour/)
    expect(friendlyAuthError({ code: 'over_request_rate_limit', status: 429 })).toMatch(/few minutes/)
    expect(friendlyAuthError({ status: 429 })).toMatch(/few minutes/)
  })
  it('still covers the common cases without leaking whether an email exists', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Incorrect email or password.')
    expect(friendlyAuthError({ code: 'email_not_confirmed' })).toMatch(/confirm your email first/i)
    expect(friendlyAuthError({ code: 'user_already_exists' })).toMatch(/could not create/i)
    expect(friendlyAuthError(null)).toBeNull()
  })
})

describe('preview banner', () => {
  it('is absent on normal builds', () => {
    const { container } = render(<PreviewBanner />)
    expect(container).toBeEmptyDOMElement()
  })
  it('is shown when the build is a preview', () => {
    vi.stubEnv('VITE_PREVIEW', '1')
    render(<PreviewBanner />)
    expect(screen.getByRole('note')).toHaveTextContent('PREVIEW build for testing')
  })
})

describe('app served from a sub-path', () => {
  it('routes and links respect the basename', async () => {
    const fake = makeFakeAuth()
    const router = createMemoryRouter(routes, { initialEntries: ['/shuvromed/'], basename: '/shuvromed' })
    render(
      <ContentClientContext.Provider value={realContentClient()}>
        <AuthProvider client={fake.client}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ContentClientContext.Provider>,
    )
    expect(await screen.findByRole('link', { name: /create free account/i })).toHaveAttribute('href', '/shuvromed/signup')
    expect(router.state.location.pathname).toBe('/shuvromed/') // location keeps the basename; matching ignores it
  })
})
