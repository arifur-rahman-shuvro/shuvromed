import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { ContentClientContext } from '../data/ContentContext'
import { addAttempt, type Attempt } from '../practice/attempts'
import { RemoteFactoryContext } from '../sync/SyncContext'
import { MemoryServer, memoryRemote, resetDevices } from './memoryRemote'
import { makeFakeAuth } from './fakeAuthClient'
import { TEST_USER_ID, realContentClient } from './utils'

const attempt: Attempt = { id: '00000000-0000-4000-8000-000000000001', questionId: 'demo-anat-cor-001', selectedOptionId: 'A', isCorrect: true, timeMs: 1000, mode: 'practice', attemptedAt: '2026-11-07T04:00:00.000Z', contentVersion: 'v1' }

function open(server: MemoryServer | null) {
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: ['/app'] })
  return render(
    <ContentClientContext.Provider value={realContentClient()}>
      <RemoteFactoryContext.Provider value={() => (server ? memoryRemote(server) : null)}>
        <AuthProvider client={fake.client}>
          <RouterProvider router={router} />
        </AuthProvider>
      </RemoteFactoryContext.Provider>
    </ContentClientContext.Provider>,
  )
}
const status = () => screen.getAllByRole('status').map((e) => e.textContent).join(' | ')

describe('sync status and triggers', () => {
  beforeEach(() => resetDevices())

  it('says plainly that data is only on this device when no server is configured', async () => {
    open(null)
    expect(await screen.findByText('Saved on this device only')).toBeInTheDocument()
  })

  it('uploads on opening and then shows everything synced', async () => {
    addAttempt(TEST_USER_ID, attempt)
    const server = new MemoryServer()
    open(server)
    expect(await screen.findByText('All changes synced', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(server.attempts.size).toBe(1)
  })

  it('shows a sync problem with a retry button, keeps the data, and recovers', async () => {
    addAttempt(TEST_USER_ID, attempt)
    const server = new MemoryServer()
    server.offline = true
    open(server)
    expect(await screen.findByText(/Sync problem/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(status()).toMatch(/1 waiting/)
    server.offline = false
    await act(async () => { await userEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(screen.getByText('All changes synced')).toBeInTheDocument(), { timeout: 4000 })
    expect(server.attempts.size).toBe(1)
  })
})
