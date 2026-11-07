import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from './utils'

describe('page changes are announced', () => {
  it('sets the tab title from the page heading and moves focus to the main area after navigating', async () => {
    const { router } = renderApp('/app')
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    await waitFor(() => expect(document.title).toBe('Dashboard · ShuvroMed'))
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    await waitFor(() => expect(document.title).toBe('Settings · ShuvroMed'))
    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(router.state.location.pathname).toBe('/app/settings')
  })

  it('does not steal focus on the very first load', async () => {
    renderApp('/app/settings')
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    await waitFor(() => expect(document.title).toBe('Settings · ShuvroMed'))
    expect(document.activeElement).toBe(document.body)
  })
})

describe('skip link', () => {
  it('is the first control and jumps to the main area', async () => {
    renderApp('/app')
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 })
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    await userEvent.tab()
    expect(document.activeElement).toBe(skip)
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})

describe('landmarks and headings', () => {
  it.each([['/'], ['/login'], ['/signup'], ['/forgot-password']])('%s has exactly one main landmark and one h1', async (path) => {
    renderApp(path, undefined, null)
    await screen.findByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('an unknown address shows a real not-found page with a way out', async () => {
    renderApp('/app/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Page not found', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute('href', '/app')
    expect(screen.queryByText(/Not built yet/)).toBeNull()
  })

  it('the practice session has an h1 for screen readers', async () => {
    renderApp('/app/practice/play?subject=anatomy&count=2')
    await screen.findByText(/Question 1 of/)
    expect(screen.getByRole('heading', { name: 'Practice session', level: 1 })).toBeInTheDocument()
  })

  it('topic headings never skip a level', async () => {
    renderApp('/app/subjects/anatomy')
    await screen.findByRole('heading', { level: 1 })
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]))
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
  })
})
