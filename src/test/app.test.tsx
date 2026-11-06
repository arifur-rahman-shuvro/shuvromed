import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '../App'
import { formatAccuracy, getDashboardStats } from '../lib/stats'
import { applyTheme, resolveDark } from '../lib/theme'

function renderAt(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('landing', () => {
  it('shows the educational disclaimer and sign-up link', () => {
    renderAt('/')
    expect(screen.getByText(/Educational use only/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create free account/i })).toHaveAttribute('href', '/signup')
  })
})

describe('dashboard', () => {
  it('shows real (zero) numbers and an empty state, not fake data', async () => {
    renderAt('/app')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
    expect(screen.getByText('0 days')).toBeInTheDocument()
  })

  it('navigates between sections via the sidebar', async () => {
    renderAt('/app')
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
