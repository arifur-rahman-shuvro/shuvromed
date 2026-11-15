import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { ContentClientContext } from '../data/ContentContext'
import type { QuestionRepo } from '../questions/repo'
import { QuestionRepoContext } from '../questions/repo'
import type { SessionRepo } from '../session/repo'
import { SessionRepoContext } from '../session/repo'
import type { WorkspaceRepo } from '../workspace/repo'
import { WorkspaceRepoContext } from '../workspace/repo'
import { makeFakeAuth } from './fakeAuthClient'
import { realContentClient, TEST_USER_ID } from './utils'

function mountHome(overrides: { sessions?: Partial<SessionRepo> } = {}) {
  localStorage.setItem(`shuvromed.workspace.enabled.v1.${TEST_USER_ID}`, '1')
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: ['/app'] })
  const workspace = {
    load: vi.fn(async () => ({ data: { subjects: [], topics: [] }, error: null })),
  } as unknown as WorkspaceRepo
  const questions = {
    list: vi.fn(async () => ({ data: [], error: null })),
  } as unknown as QuestionRepo
  const sessions = {
    list: vi.fn(async () => ({ data: [], error: null })),
    allAttempts: vi.fn(async () => ({ data: [], error: null })),
    ...overrides.sessions,
  } as unknown as SessionRepo
  render(
    <ContentClientContext.Provider value={realContentClient()}>
      <WorkspaceRepoContext.Provider value={workspace}>
        <QuestionRepoContext.Provider value={questions}>
          <SessionRepoContext.Provider value={sessions}>
            <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
          </SessionRepoContext.Provider>
        </QuestionRepoContext.Provider>
      </WorkspaceRepoContext.Provider>
    </ContentClientContext.Provider>,
  )
  return { sessions }
}

beforeEach(() => localStorage.clear())

describe('workspace Home retrieval failures', () => {
  it('shows an error instead of zero sessions when session retrieval fails', async () => {
    mountHome({ sessions: { list: vi.fn(async () => ({ data: null, error: 'temporary session read failure' })) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open your workspace.')
    expect(screen.queryByText('Due for revision')).not.toBeInTheDocument()
  })

  it('shows an error instead of zero answers when attempt retrieval fails', async () => {
    mountHome({ sessions: { allAttempts: vi.fn(async () => ({ data: null, error: 'temporary attempt read failure' })) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open your workspace.')
    expect(screen.queryByText('Due for revision')).not.toBeInTheDocument()
  })

  it('recovers when the learner retries after a temporary session read failure', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: null, error: 'temporary session read failure' })
      .mockResolvedValueOnce({ data: [], error: null })
    mountHome({ sessions: { list } })
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Getting started' })).toBeInTheDocument()
  })
})
