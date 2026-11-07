import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadAttempts, resetAttemptCache } from '../practice/attempts'
import { loadMock, resetMockCache } from '../mock/store'
import { TEST_USER_ID, renderApp } from './utils'

describe('mock exam in the browser UI', () => {
  beforeEach(() => {
    localStorage.clear()
    resetAttemptCache()
    resetMockCache()
  })

  it('start, answer, finish: lands on the result page, records answers as mock attempts, and clears the exam in progress', async () => {
    const { router } = renderApp('/app/mock')
    await screen.findByRole('heading', { name: 'Mock exam' })
    const count = screen.getByLabelText(/Number of questions/)
    await userEvent.clear(count)
    await userEvent.type(count, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Start exam' }))
    expect(await screen.findByTestId('mock-progress')).toHaveTextContent('Question 1 of 3')
    expect(screen.queryByText(/Explanation/)).not.toBeInTheDocument() // no feedback during the exam
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Finish exam' }))
    expect(screen.getByText(/2 unanswered questions count as wrong/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finish and see results' }))
    expect(await screen.findByRole('heading', { name: 'Exam result' })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/mock\/result\//))
    const attempts = loadAttempts(TEST_USER_ID)
    expect(attempts).toHaveLength(1) // unanswered questions record nothing
    expect(attempts[0].mode).toBe('mock')
    expect(loadMock(TEST_USER_ID)).toMatchObject({ active: null, results: [{ total: 3, answered: 1 }] })
  })

  it('an exam in progress is offered for resume after a reload, with answers kept', async () => {
    const first = renderApp('/app/mock')
    await screen.findByRole('heading', { name: 'Mock exam' })
    const count = screen.getByLabelText(/Number of questions/)
    await userEvent.clear(count)
    await userEvent.type(count, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Start exam' }))
    await screen.findByTestId('mock-progress')
    await userEvent.click(screen.getAllByRole('radio')[1])
    first.unmount()
    resetMockCache() // as after a page reload: only storage remains
    renderApp('/app/mock/run')
    expect(await screen.findByRole('button', { name: 'Question 1, answered' })).toBeInTheDocument()
  })
})

describe('reaching the mock exam on a phone', () => {
  it('the Dashboard links to the mock exam (the phone bottom bar has no room for it)', async () => {
    renderApp('/app')
    expect(await screen.findByRole('link', { name: 'Mock exam' })).toHaveAttribute('href', '/app/mock')
  })
})
