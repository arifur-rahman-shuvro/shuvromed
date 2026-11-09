import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { render, screen, waitFor, within } from '@testing-library/react'
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
const user = userEvent.setup()

function mount(path: string) {
  setWorkspaceEnabled(TEST_USER_ID, true)
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <ContentClientContext.Provider value={realContentClient()}>
      <WorkspaceEnvContext.Provider value={{ openBackend: (id) => openIdbBackend(id, factory), remote: server, debounceMs: 5 }}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </WorkspaceEnvContext.Provider>
    </ContentClientContext.Provider>,
  )
  return { router, ...view }
}
const rows = (t: string) => [...(server.tables.get(t)?.values() ?? [])]

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  server = fakeServer()
  factory = new IDBFactory()
  server.externalInsert('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null })
})

async function chooseSubject(name = 'Anatomy') {
  const select = await screen.findByLabelText('Subject (required)')
  await waitFor(() => expect(within(select).queryByRole('option', { name })).toBeTruthy())
  await user.selectOptions(select, name)
}


async function addQuestion(stem: string) {
  await user.type(screen.getByLabelText('Question'), stem)
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Remove option 3' }))
  await user.type(screen.getByLabelText('Option 1 text'), 'Alpha')
  await user.type(screen.getByLabelText('Option 2 text'), 'Beta')
  await user.click(screen.getByLabelText('Option 1 is correct'))
}

describe('My tags', () => {
  it('adds, renames, archives and deletes a tag, and refuses a duplicate', async () => {
    mount('/app/workspace/tags')
    expect(await screen.findByText('No exam tags yet')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Add exam tag' }))
    await user.type(screen.getByLabelText('Tag name'), 'FCPS Part 1')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    await screen.findByText('FCPS Part 1')
    await user.click(screen.getByRole('button', { name: 'Add exam tag' }))
    await user.type(screen.getByLabelText('Tag name'), 'fcps part 1')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Rename: FCPS Part 1' }))
    const box = screen.getByLabelText('New name')
    await user.clear(box)
    await user.type(box, 'FCPS 1')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await screen.findByText('FCPS 1')

    await user.click(screen.getByRole('button', { name: 'Archive: FCPS 1' }))
    await screen.findByText('FCPS 1 (archived)')
    await user.click(screen.getByRole('button', { name: 'Restore: FCPS 1' }))
    await user.click(await screen.findByRole('button', { name: 'Delete: FCPS 1' }))
    await user.click(screen.getByRole('button', { name: 'Delete tag' }))
    await waitFor(() => expect(screen.queryByText('FCPS 1')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_tags')).toHaveLength(0))
  })

  it('hides the screen until the workspace is switched on', async () => {
    localStorage.clear()
    const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
    const router = createMemoryRouter(routes, { initialEntries: ['/app/workspace/tags'] })
    render(
      <ContentClientContext.Provider value={realContentClient()}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </ContentClientContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    expect(router.state.location.pathname).toBe('/app/settings')
  })
})

describe('tagging questions', () => {
  it('tags a question while writing it, shows Universal or exam-limited, and syncs the link', async () => {
    mount('/app/workspace/questions/new')
    await chooseSubject()
    await addQuestion('Tagged?')
    expect(screen.getByText(/Universal: no exam tag/)).toBeTruthy()
    await user.type(screen.getByLabelText('New tag name'), 'MBBS Final')
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(await screen.findByText(/limited to its exam tags/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await screen.findByText('Question added.')
    expect(await screen.findByText('MBBS Final')).toBeTruthy()
    expect(screen.queryByText('Universal')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_question_tag_links')).toHaveLength(1))
    expect(rows('user_tags')[0]).toMatchObject({ name: 'MBBS Final', category: 'exam' })
  })

  it('bulk adds a tag to selected questions and undoes it', async () => {
    server.externalInsert('user_tags', { category: 'general', name: 'High yield', archived_at: null })
    for (const stem of ['One?', 'Two?']) {
      const m = mount('/app/workspace/questions/new')
      await chooseSubject()
      await addQuestion(stem)
      await user.click(screen.getByRole('button', { name: 'Add question' }))
      await screen.findByText('Question added.')
      m.unmount()
    }
    mount('/app/workspace/questions')
    await screen.findByText('One?')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('button', { name: /^Select all \d+ matching$/ }))
    await user.selectOptions(screen.getByLabelText('Tag'), await screen.findByRole('option', { name: 'High yield (general)' }))
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    await screen.findByText(/Added "High yield" to 2 questions/)
    await waitFor(() => expect(screen.getAllByText('High yield').length).toBeGreaterThanOrEqual(2))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByText('Undone.')
    await waitFor(() => expect(screen.queryAllByText('High yield')).toHaveLength(0))
  })
})
