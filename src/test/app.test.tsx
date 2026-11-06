import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { formatAccuracy, getDashboardStats } from '../lib/stats'
import { applyTheme, resolveDark } from '../lib/theme'
import { renderApp } from './utils'

describe('landing', () => {
  it('shows the educational disclaimer and sign-up / sign-in links', async () => {
    renderApp('/', undefined)
    expect(await screen.findByText(/Educational use only/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create free account/i })).toHaveAttribute('href', '/signup')
    const signInLinks = screen.getAllByRole('link', { name: 'Sign in' })
    expect(signInLinks.length).toBeGreaterThanOrEqual(1)
    for (const l of signInLinks) expect(l).toHaveAttribute('href', '/login')
  })
})

describe('dashboard (signed in)', () => {
  it('shows real (zero) numbers and an empty state, not fake data', async () => {
    renderApp('/app')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
    expect(screen.getByText('0 days')).toBeInTheDocument()
  })

  it('navigates between sections via the sidebar', async () => {
    renderApp('/app')
    await screen.findByRole('heading', { name: 'Dashboard' })
    await userEvent.click(screen.getAllByRole('link', { name: 'Subjects' })[0])
    expect(await screen.findByRole('heading', { name: 'Subjects' })).toBeInTheDocument()
  })
})

describe('stats helpers', () => {
  it('formats missing accuracy as a dash and rounds otherwise', () => {
    expect(formatAccuracy(null)).toBe('—')
    expect(formatAccuracy(66.6)).toBe('67%')
  })
  it('starts with zero attempts', () => {
    expect(getDashboardStats().attempted).toBe(0)
  })
})

describe('theme', () => {
  it('applies and persists dark mode', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(resolveDark('light')).toBe(false)
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
