import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { ContentClientContext } from '../data/ContentContext'
import { setWorkspaceEnabled } from '../workspace/flag'
import { openIdbBackend } from '../workspace/store/idb'
import { WorkspaceEnvContext } from '../workspace/WorkspaceProvider'
import { makeFakeAuth } from './fakeAuthClient'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'
import { TEST_USER_ID, realContentClient } from './utils'

let server: FakeServer
let factory: IDBFactory

function mount() {
  localStorage.clear()
  setWorkspaceEnabled(TEST_USER_ID, true)
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: ['/app/workspace/subjects'] })
  return render(
    <ContentClientContext.Provider value={realContentClient()}>
      <WorkspaceEnvContext.Provider value={{ openBackend: (id) => openIdbBackend(id, factory), remote: server, debounceMs: 5 }}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </WorkspaceEnvContext.Provider>
    </ContentClientContext.Provider>,
  )
}
const serverSubjects = () => [...(server.tables.get('user_subjects')?.values() ?? [])]

beforeEach(() => { server = fakeServer(); factory = new IDBFactory() })

describe('My subjects with the on-device store', () => {
  it('works offline, then syncs when the connection returns', async () => {
    server.down = true
    mount()
    await userEvent.type(await screen.findByLabelText('New subject name'), 'Anatomy')
    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }))
    await screen.findByRole('heading', { name: 'Anatomy', level: 2 })
    await waitFor(() => expect(screen.getByLabelText('Sync status').textContent).toMatch(/Offline\. 1 change saved on this device/))
    expect(serverSubjects()).toHaveLength(0)

    server.down = false
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(screen.getByLabelText('Sync status').textContent).toMatch(/All changes saved/))
    expect(serverSubjects().map((r) => r.name)).toEqual(['Anatomy'])
  })

  it('shows what another device added after a sync', async () => {
    mount()
    await screen.findByText('No subjects yet')
    server.externalInsert('user_subjects', { name: 'Physiology', description: null, sort_order: 0, archived_at: null })
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await screen.findByRole('heading', { name: 'Physiology', level: 2 })
  })

  it('keeps the data after the screen is reopened (it is stored on the device)', async () => {
    server.down = true
    const first = mount()
    await userEvent.type(await screen.findByLabelText('New subject name'), 'Pathology')
    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }))
    await screen.findByRole('heading', { name: 'Pathology', level: 2 })
    first.unmount()
    mount()
    await screen.findByRole('heading', { name: 'Pathology', level: 2 })
  })

  it('tells you when the server refuses a change and lets you discard it', async () => {
    mount()
    await screen.findByText('No subjects yet')
    server.refuse = { code: '23505', message: 'That name is already used here.' }
    await userEvent.type(screen.getByLabelText('New subject name'), 'Clash')
    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }))
    const alert = await screen.findByText(/The server refused 1 change/)
    expect(alert).toBeTruthy()
    server.refuse = null
    await userEvent.click(screen.getByRole('button', { name: 'Discard that change' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Clash' })).toBeNull())
    await waitFor(() => expect(screen.queryByText(/The server refused/)).toBeNull())
  })
})
