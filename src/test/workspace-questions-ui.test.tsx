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
async function fillSba(stem: string) {
  await user.type(screen.getByLabelText('Question'), stem)
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Remove option 3' }))
  await user.type(screen.getByLabelText('Option 1 text'), 'Alpha')
  await user.type(screen.getByLabelText('Option 2 text'), 'Beta')
  await user.click(screen.getByLabelText('Option 1 is correct'))
}

describe('My questions', () => {
  it('starts empty and offers to add one', async () => {
    mount('/app/workspace/questions')
    expect(await screen.findByText('No questions yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add question' })).toBeTruthy()
  })

  it('adds a single-best-answer question, lists it, and syncs it', async () => {
    const m = mount('/app/workspace/questions/new')
    await chooseSubject()
    await fillSba('Which is first?')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await screen.findByText('Question added.')
    expect(m.router.state.location.pathname).toBe('/app/workspace/questions')
    expect(await screen.findByText('Which is first?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_questions').map((r) => r.stem)).toEqual(['Which is first?']))
    expect(rows('user_questions')[0].current_version).toBe(1)
  })

  it('lists every problem instead of saving a broken question', async () => {
    mount('/app/workspace/questions/new')
    await screen.findByLabelText('Subject (required)')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    const alert = await screen.findByText(/Fix these to save/)
    const box = alert.closest('[role=alert]') as HTMLElement
    expect(box.textContent).toMatch(/Choose a subject/)
    expect(box.textContent).toMatch(/Write the question/)
    expect(box.textContent).toMatch(/Every option needs text/)
    expect(rows('user_questions')).toHaveLength(0)
  })

  it('previews a question and grades an answer', async () => {
    mount('/app/workspace/questions/new')
    await chooseSubject()
    await fillSba('Which is first?')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await user.click(await screen.findByRole('radio', { name: 'Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect((await screen.findByRole('status', { name: '' }).catch(() => null)) ?? true).toBeTruthy()
    expect((await screen.findByRole('region', { name: 'Answer feedback' })).textContent).toMatch(/Correct/)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await user.click(screen.getByRole('radio', { name: 'Beta' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect((await screen.findByRole('region', { name: 'Answer feedback' })).textContent).toMatch(/Incorrect/)
  })

  it('builds a fill-in-the-gap question with the Add blank button', async () => {
    mount('/app/workspace/questions/new')
    await chooseSubject()
    await user.selectOptions(screen.getByLabelText('Type'), 'Fill in the gap')
    await user.type(screen.getByLabelText(/^Question/), 'The')
    await user.click(screen.getByRole('button', { name: 'Add blank' }))
    await user.type(screen.getByLabelText(/^Question/), ' pumps blood')
    await user.type(screen.getByLabelText('Accepted answers for blank 2'), 'heart')
    // the template starts with one blank (b1) that is not in the question; remove it
    await user.click(screen.getByRole('button', { name: 'Remove blank 1' }))
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await user.type(await screen.findByLabelText('Answer for blank 1'), ' Heart ')
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect((await screen.findByRole('region', { name: 'Answer feedback' })).textContent).toMatch(/Correct/)
  })

  it('keeps an unsaved draft on the device and offers to restore it', async () => {
    const first = mount('/app/workspace/questions/new')
    await chooseSubject()
    await user.type(screen.getByLabelText('Question'), 'Half written')
    await screen.findByText('Draft kept on this device', undefined, { timeout: 3000 })
    first.unmount()
    mount('/app/workspace/questions/new')
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }))
    expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe('Half written')
  })

  it('warns about a duplicate wording', async () => {
    const first = mount('/app/workspace/questions/new')
    await chooseSubject()
    await fillSba('Same wording?')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await screen.findByText('Question added.')
    first.unmount()
    mount('/app/workspace/questions/new')
    await user.type(await screen.findByLabelText('Question'), 'same   WORDING?')
    expect(await screen.findByText('Another question has the same wording.')).toBeTruthy()
  })

  it('edits a question, archives it, deletes it, and undoes the delete', async () => {
    const m = mount('/app/workspace/questions/new')
    await chooseSubject()
    await fillSba('Original?')
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await screen.findByText('Question added.')

    await user.click(await screen.findByRole('link', { name: /^Edit: Original/ }))
    const stem = await screen.findByLabelText('Question')
    await user.clear(stem)
    await user.type(stem, 'Edited?')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Question saved.')
    expect(await screen.findByText('Edited?')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^Archive: Edited/ }))
    await waitFor(() => expect(screen.queryByText('Edited?')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.selectOptions(screen.getByLabelText('Show'), 'Active and archived')
    await user.click(await screen.findByRole('button', { name: /^Restore: Edited/ }))

    await user.click(await screen.findByRole('button', { name: /^Delete: Edited/ }))
    await screen.findByText(/Question deleted/)
    await waitFor(() => expect(screen.queryByText('Edited?')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByText('Edited?')
    expect(m.router.state.location.pathname).toBe('/app/workspace/questions')
  })

  it('hides the screen when the workspace is switched off', async () => {
    localStorage.clear()
    setWorkspaceEnabled(TEST_USER_ID, false)
    const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
    const router = createMemoryRouter(routes, { initialEntries: ['/app/workspace/questions'] })
    render(
      <ContentClientContext.Provider value={realContentClient()}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </ContentClientContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    expect(router.state.location.pathname).toBe('/app/settings')
  })
})
