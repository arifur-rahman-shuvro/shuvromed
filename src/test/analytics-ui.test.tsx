import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAttempt, resetAttemptCache, type Attempt } from '../practice/attempts'
import { TEST_USER_ID, renderApp } from './utils'

let n = 0
const put = (questionId: string, isCorrect: boolean, extra: Partial<Attempt> = {}) =>
  addAttempt(TEST_USER_ID, { id: crypto.randomUUID(), questionId, selectedOptionId: 'A', isCorrect, timeMs: 20_000, mode: 'practice', attemptedAt: new Date(Date.now() - ++n * 1000).toISOString(), contentVersion: 'v', ...extra })

describe('analytics page', () => {
  beforeEach(() => {
    localStorage.clear()
    resetAttemptCache()
  })

  it('shows an honest empty state with no answers', async () => {
    renderApp('/app/analytics')
    expect(await screen.findByRole('heading', { name: 'Nothing to analyse yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a subject' })).toBeInTheDocument()
  })

  it('says there is not enough data instead of inventing weak topics', async () => {
    put('demo-anat-cor-001', false)
    renderApp('/app/analytics')
    expect(await screen.findByText(/Not enough answers yet/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(screen.getByText(/not a prediction of any exam result/i)).toBeInTheDocument()
  })

  it('lists a weak topic with its numbers and a practice link for exactly that topic', async () => {
    put('demo-anat-cor-001', false); put('demo-anat-cor-002', false); put('demo-anat-cor-003', true, { confidence: 5 })
    renderApp('/app/analytics')
    const weak = await screen.findByRole('region', { name: 'Weak topics' })
    expect(within(weak).getByText('Coronary arteries')).toBeInTheDocument()
    expect(within(weak).getByText('33%')).toBeInTheDocument()
    expect(within(weak).getByText(/3 answers · 1 correct/)).toBeInTheDocument()
    const link = within(weak).getByRole('link', { name: /Practise Coronary arteries/ })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('/app/practice?')
    expect(href).toContain('topic=anatomy-coronary-arteries')
    expect(href).toContain('subject=anatomy')
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveTextContent('Answers3')
  })

  it('every graphic has its numbers as text, and the day chart has a table', async () => {
    put('demo-anat-cor-001', true)
    renderApp('/app/analytics')
    const days = await screen.findByRole('region', { name: 'Recent days' })
    await userEvent.click(within(days).getByText('View as a table'))
    const table = within(days).getByRole('table', { name: /Answers per day/ })
    expect(within(table).getAllByRole('row')).toHaveLength(15) // header + 14 days
    expect(within(table).getByText('1 (1 correct)')).toBeInTheDocument()
  })

  it('confidence section explains how to unlock it when nothing is rated', async () => {
    put('demo-anat-cor-001', true)
    renderApp('/app/analytics')
    expect(await screen.findByText(/You have not rated your confidence yet/)).toBeInTheDocument()
  })

  it('the navigation reaches the analytics page', async () => {
    renderApp('/app/analytics')
    expect((await screen.findAllByRole('link', { name: 'Analytics' })).length).toBeGreaterThan(0)
  })
})
