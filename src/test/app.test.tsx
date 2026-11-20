import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatAccuracy, getDashboardStats } from '../lib/stats'
import { applyTheme, resolveDark } from '../lib/theme'
import { renderApp, TEST_USER_ID } from './utils'

beforeEach(() => localStorage.clear())

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

  it('routes workspace setup actions to private learning modules when enabled', async () => {
    localStorage.setItem(`shuvromed.workspace.enabled.v1.${TEST_USER_ID}`, '1')
    renderApp('/app')
    await screen.findByRole('heading', { name: 'Home', level: 1 })
    expect(await screen.findByRole('link', { name: 'Explore subjects' })).toHaveAttribute('href', '/app/workspace/subjects')
    expect(screen.getByRole('link', { name: 'Add questions' })).toHaveAttribute('href', '/app/workspace/questions/new')
    expect(screen.getByRole('link', { name: 'Import questions' })).toHaveAttribute('href', '/app/workspace/import')
    expect(screen.getByRole('link', { name: 'Start practising' })).toHaveAttribute('href', '/app/workspace/practice')
    const menu = screen.getByRole('navigation', { name: 'Main' })
    expect(menu.querySelector('a[href="/app/subjects"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'My questions' })).toHaveAttribute('href', '/app/workspace/questions')
  })

  it('returns keyboard focus to the command palette trigger when dismissed', async () => {
    const user = userEvent.setup()
    renderApp('/app')
    const trigger = await screen.findByRole('button', { name: 'Search commands' })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
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
