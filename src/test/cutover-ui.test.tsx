import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { ContentClientContext } from '../data/ContentContext'
import { openIdbBackend } from '../workspace/store/idb'
import { WorkspaceEnvContext } from '../workspace/WorkspaceProvider'
import { makeFakeAuth } from './fakeAuthClient'
import { fakeServer, type FakeServer } from './memoryWorkspaceRemote'
import { realContentClient } from './utils'

let server: FakeServer
let factory: IDBFactory
const user = userEvent.setup()

/** Mounts the app the way a brand-new install would: no workspace choice has been made, so the default applies. */
function mount(path: string) {
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ContentClientContext.Provider value={realContentClient()}>
      <WorkspaceEnvContext.Provider value={{ openBackend: (id) => openIdbBackend(id, factory), remote: server, debounceMs: 5 }}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </WorkspaceEnvContext.Provider>
    </ContentClientContext.Provider>,
  )
  return router
}
const SBA = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
function seedSubject() { return server.externalInsert('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null }) }
function seedQuestion(subjectId: string, stem: string, content: unknown = SBA) {
  const q = server.externalInsert('user_questions', { subject_id: subjectId, question_type: 'SBA', stem, difficulty: null, content, explanation: null, reference: null, archived_at: null, deleted_at: null, current_version: 1 })
  server.versions.set(q.id, [{ version: 1, question_type: 'SBA', stem, difficulty: null, content, explanation: null, reference: null, subject_id: subjectId, subject_name: 'Anatomy', created_at: q.updated_at }])
  return q
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); server = fakeServer(); factory = new IDBFactory() })
afterEach(() => { Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true }) })

describe('first screen after the cutover', () => {
  it('a new install lands on Home with the three-step guide and the workspace menu', async () => {
    mount('/app')
    await screen.findByRole('heading', { name: 'Home', level: 1 })
    expect(await screen.findByText(/Step 1: Create a subject/)).toBeTruthy()
    expect(screen.getByText(/Step 2: Add your questions/)).toBeTruthy()
    expect(screen.getByText(/Step 3: Practise or sit an exam/)).toBeTruthy()
    const menu = screen.getByRole('navigation', { name: 'Main' })
    expect(within(menu).getByRole('link', { name: 'My questions' })).toBeTruthy()
    expect(within(menu).getByRole('link', { name: 'Data health' })).toBeTruthy()
    expect(within(menu).queryByRole('link', { name: /^Old / })).toBeNull()
  })

  it('marks finished steps and then shows the summary instead of the guide', async () => {
    const s = seedSubject()
    mount('/app')
    expect(await screen.findByText(/Step 1: Create a subject \(done\)/)).toBeTruthy()
    seedQuestion(s.id, 'First question')
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText('due for revision')).toBeTruthy()
    expect(screen.queryByText(/Welcome/)).toBeNull()
    expect(screen.getByLabelText('Summary').textContent).toContain('1')
  })

  it('shows an unfinished session to continue', async () => {
    const s = seedSubject()
    seedQuestion(s.id, 'First question')
    const router = mount('/app/workspace/practice')
    await screen.findByText('1 question available.')
    await user.click(screen.getByRole('button', { name: 'Start practice' }))
    await screen.findByText(/Question 1 of 1/)
    await user.click(screen.getByRole('button', { name: 'Pause and leave' }))
    await router.navigate('/app')
    expect(await screen.findByRole('link', { name: /^Continue:/ })).toBeTruthy()
  })
})

describe('old demo screens', () => {
  it('stay out of the menu until the Settings switch is used, and the old dashboard still opens', async () => {
    const router = mount('/app/settings')
    await user.click(await screen.findByRole('checkbox', { name: 'Also list the old demo screens in the menu' }))
    const menu = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(menu).getByRole('link', { name: 'Old subjects' })).toBeTruthy()
    expect(within(menu).getByRole('link', { name: 'Old analytics' })).toBeTruthy()
    await router.navigate('/app/legacy')
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeTruthy()
  })
})

describe('data health screen', () => {
  it('shows the storage meter, sync state and a clean check', async () => {
    Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 500 * 1024 * 1024 }), persisted: async () => true }, configurable: true })
    const s = seedSubject()
    seedQuestion(s.id, 'Fine question')
    mount('/app/workspace/health')
    expect(await screen.findByText(/The app uses 5\.0 MB of about 500 MB this browser allows \(1%\)/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Storage used' })).toBeTruthy()
    expect(screen.getByText(/The browser will keep this data/)).toBeTruthy()
    expect(await screen.findByText('No problems found.')).toBeTruthy()
    expect(screen.getByText(/1 question,/)).toBeTruthy()
  })

  it('reports a question whose answer data is broken, without changing anything', async () => {
    const s = seedSubject()
    seedQuestion(s.id, 'Broken question', { options: SBA.options, correct_option_id: 'zzz' })
    mount('/app/workspace/health')
    expect(await screen.findByText('Questions whose answer data is not valid: 1')).toBeTruthy()
    expect(screen.getByText(/For example: Broken question/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/1 problem found/)
    expect([...(server.tables.get('user_questions')?.values() ?? [])].length).toBe(1)
  })

  it('says so when the browser cannot report storage', async () => {
    seedSubject()
    mount('/app/workspace/health')
    expect(await screen.findByText(/cannot tell how much space is used/)).toBeTruthy()
  })
})
