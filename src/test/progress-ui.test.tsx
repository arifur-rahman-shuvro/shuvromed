import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetAttemptCache, addAttempt } from '../practice/attempts'
import { TEST_USER_ID, renderApp } from './utils'

const A = (i: number, over = {}) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, questionId: `q${i}`, selectedOptionId: 'A' as const, isCorrect: true, timeMs: 1000, mode: 'practice' as const, attemptedAt: new Date().toISOString(), contentVersion: 'v', ...over })

describe('progress page and dashboard', () => {
  beforeEach(() => { localStorage.clear(); resetAttemptCache() })

  it('dashboard shows real XP and level', async () => {
    addAttempt(TEST_USER_ID, A(1)); addAttempt(TEST_USER_ID, A(2, { isCorrect: false }))
    renderApp('/app')
    const stat = (await screen.findByText('XP / Level')).parentElement!
    expect(stat).toHaveTextContent('13 XP')
    expect(stat).toHaveTextContent('L1')
  })

  it('progress page shows level, streak, badges with earned and locked states', async () => {
    for (let i = 1; i <= 10; i++) addAttempt(TEST_USER_ID, A(i))
    renderApp('/app/progress')
    expect(await screen.findByRole('heading', { name: 'Level 2' })).toBeInTheDocument()
    expect(screen.getByTestId('xp-total')).toHaveTextContent('100 XP')
    expect(screen.getByText('Current streak').parentElement).toHaveTextContent('1 day')
    const badges = screen.getByRole('region', { name: 'Badges' })
    expect(within(badges).getByRole('heading', { name: /Badges \(2 of 12\)/ })).toBeInTheDocument()
    expect(within(badges).getAllByText('Locked').length).toBe(10)
    expect(within(badges).getByText('Answer 100 questions.')).toBeInTheDocument()
  })

  it('the switch hides XP, level and badges everywhere but keeps the streak', async () => {
    addAttempt(TEST_USER_ID, A(1))
    renderApp('/app/progress')
    await userEvent.click(await screen.findByRole('checkbox', { name: /Show XP, levels and badges/ }))
    expect(screen.getByText(/XP, levels and badges are hidden/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Badges' })).not.toBeInTheDocument()
    expect(screen.getByText('Current streak')).toBeInTheDocument()
    expect(localStorage.getItem(`shuvromed.gamification.v1.${TEST_USER_ID}`)).toBe('off')
    await userEvent.click(screen.getAllByRole('link', { name: 'Dashboard' })[0])
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText('XP / Level')).not.toBeInTheDocument()
    expect(screen.getByText('Streak')).toBeInTheDocument()
  })
})
