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





const SBA_CONTENT = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
let subjectId = ''
function seedQuestion(stem: string, over: Record<string, unknown> = {}) {
  return server.externalInsert('user_questions', {
    subject_id: subjectId, question_type: 'SBA', stem, difficulty: null, content: SBA_CONTENT, explanation: null, reference: null,
    archived_at: null, deleted_at: null, current_version: 1, ...over,
  })
}
beforeEach(() => { subjectId = [...server.tables.get('user_subjects')!.values()][0].id })

async function openFilters() { await user.click(await screen.findByRole('button', { name: /^Filters/ })) }

describe('question bank', () => {
  it('searches wording, options and explanation, shows the count, and clears', async () => {
    seedQuestion('Which valve lies between the atrium and ventricle?')
    seedQuestion('Renal blood flow is autoregulated.', { question_type: 'TRUE_FALSE', content: { correct_answer: true }, explanation: 'Myogenic response' })
    mount('/app/workspace/questions')
    await screen.findByText('2 questions')
    await user.type(screen.getByLabelText('Search questions'), 'myogenic')
    await screen.findByText('1 question match your filters (of 2)')
    expect(screen.getByText('Renal blood flow is autoregulated.')).toBeTruthy()
    expect(screen.queryByText(/Which valve/)).toBeNull()
    await user.clear(screen.getByLabelText('Search questions'))
    await user.type(screen.getByLabelText('Search questions'), 'zzzz')
    expect(await screen.findByText('No questions match')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await screen.findByText('2 questions')
  })

  it('filters by type, tag and state, and shows how many filters are on', async () => {
    const tag = server.externalInsert('user_tags', { category: 'exam', name: 'FCPS', archived_at: null })
    const a = seedQuestion('Alpha question')
    seedQuestion('Beta question', { question_type: 'TRUE_FALSE', content: { correct_answer: false } })
    seedQuestion('Gamma archived', { archived_at: '2026-11-08T00:00:00Z' })
    server.externalInsert('user_question_tag_links', { question_id: a.id, tag_id: tag.id })
    server.external('user_questions', a.id, { stem: 'Alpha question' }) // marks it changed so its links are read
    mount('/app/workspace/questions')
    await screen.findByText('2 questions')
    await openFilters()
    await user.click(screen.getByRole('checkbox', { name: 'True / False' }))
    await screen.findByText(/1 question match/)
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'True / False' }))
    await user.click(screen.getByRole('checkbox', { name: 'FCPS' }))
    await screen.findByText(/1 question match/)
    expect(screen.getByText('Alpha question')).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'FCPS' }))
    await user.selectOptions(screen.getByLabelText('Show'), 'Archived only')
    expect(await screen.findByText('Gamma archived')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Wording A to Z')
  })

  it('shows 50 at a time and loads more', async () => {
    for (let i = 0; i < 60; i++) seedQuestion(`Statement ${String(i).padStart(2, '0')}`)
    mount('/app/workspace/questions')
    await screen.findByText('60 questions')
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Show 10 more' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60))
  })

  it('saves a filter, applies it later, updates it, deletes it, and syncs it', async () => {
    seedQuestion('Valve one'); seedQuestion('Kidney two')
    mount('/app/workspace/questions')
    await screen.findByText('2 questions')
    await user.type(screen.getByLabelText('Search questions'), 'valve')
    await screen.findByText(/1 question match/)
    await openFilters()
    await user.click(screen.getByRole('button', { name: 'Save current filter' }))
    await user.type(screen.getByLabelText('Name for this filter'), 'Valves')
    await user.click(screen.getByRole('button', { name: 'Save filter' }))
    await screen.findByText('Saved filter "Valves".')
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_saved_filters').map((r) => r.name)).toEqual(['Valves']))

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await screen.findByText('2 questions')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Saved filters' }), 'Valves')
    expect((screen.getByLabelText('Search questions') as HTMLInputElement).value).toBe('valve')
    await screen.findByText(/1 question match/)

    await user.clear(screen.getByLabelText('Search questions'))
    await user.type(screen.getByLabelText('Search questions'), 'kidney')
    await user.click(screen.getByRole('button', { name: 'Update "Valves"' }))
    await screen.findByText('Updated "Valves".')
    await user.click(screen.getByRole('button', { name: 'Delete "Valves"' }))
    await screen.findByText('Deleted saved filter "Valves".')
    expect(await screen.findByText('None saved yet')).toBeTruthy()
  })

  it('a duplicate saved-filter name is refused with a clear message', async () => {
    mount('/app/workspace/questions')
    await openFilters()
    for (const name of ['Same', 'same ']) {
      await user.click(await screen.findByRole('button', { name: 'Save current filter' }))
      await user.type(screen.getByLabelText('Name for this filter'), name)
      await user.click(screen.getByRole('button', { name: 'Save filter' }))
      if (name === 'Same') await screen.findByText('Saved filter "Same".')
    }
    expect((await screen.findByRole('alert')).textContent).toMatch(/already have a saved filter/)
  })

  it('saved filters keep working before migration M7 (the server table is missing)', async () => {
    server.missingTables.add('user_saved_filters')
    mount('/app/workspace/questions')
    await openFilters()
    await user.click(await screen.findByRole('button', { name: 'Save current filter' }))
    await user.type(screen.getByLabelText('Name for this filter'), 'Early')
    await user.click(screen.getByRole('button', { name: 'Save filter' }))
    await screen.findByText('Saved filter "Early".')
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await screen.findByText('1 change waiting to sync.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(rows('user_saved_filters')).toHaveLength(0)
  })

  it('bulk archive with undo, delete, and move to another subject after confirming', async () => {
    server.externalInsert('user_subjects', { name: 'Physiology', description: null, sort_order: 1, archived_at: null })
    seedQuestion('First'); seedQuestion('Second')
    mount('/app/workspace/questions')
    await screen.findByText('2 questions')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(screen.getByRole('button', { name: 'Select all 2 matching' }))
    await user.click(screen.getByRole('button', { name: 'Archive selected' }))
    await screen.findByText('Archived 2 questions.')
    await waitFor(() => expect(screen.queryByText('First')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByText('Undone.')
    await screen.findByText('First')

    await user.click(screen.getByRole('button', { name: /^Select all \d+ matching$/ }))
    await user.selectOptions(screen.getByLabelText('Move to subject'), await screen.findByRole('option', { name: 'Physiology' }))
    await user.click(screen.getByRole('button', { name: 'Move selected' }))
    expect(screen.getByRole('group', { name: 'Confirm move' }).textContent).toMatch(/topics are cleared/)
    await user.click(screen.getByRole('button', { name: 'Move questions' }))
    await screen.findByText(/Moved 2 questions to Physiology/)
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    const physio = rows('user_subjects').find((r) => r.name === 'Physiology')!.id
    await waitFor(() => expect(rows('user_questions').every((r) => r.subject_id === physio)).toBe(true))

    await user.click(screen.getByRole('button', { name: /^Select all \d+ matching$/ }))
    await user.click(screen.getByRole('button', { name: 'Delete selected' }))
    await screen.findByText('Deleted 2 questions.')
    expect(await screen.findByText('No questions yet')).toBeTruthy()
  })

  it('remembers the search while you go to another screen and back', async () => {
    seedQuestion('Valve one'); seedQuestion('Kidney two')
    const m = mount('/app/workspace/questions')
    await screen.findByText('2 questions')
    await user.type(screen.getByLabelText('Search questions'), 'valve')
    await screen.findByText(/1 question match/)
    m.unmount()
    mount('/app/workspace/questions')
    expect((await screen.findByLabelText('Search questions') as HTMLInputElement).value).toBe('valve')
  })
})

describe('version history', () => {
  const V = (n: number, stem: string, over: Record<string, unknown> = {}) => ({
    version: n, question_type: 'SBA', stem, difficulty: null, content: SBA_CONTENT, explanation: null, reference: null,
    subject_id: 'x', subject_name: 'Anatomy', created_at: `2026-11-0${n}T10:00:00Z`, ...over,
  })
  it('lists versions with what changed, and puts an old one back as the current wording', async () => {
    const q = seedQuestion('Third wording', { current_version: 3 })
    server.versions.set(q.id, [V(1, 'First wording'), V(2, 'Second wording', { explanation: 'Because' }), V(3, 'Third wording', { explanation: 'Because' })])
    mount(`/app/workspace/questions/${q.id}/history`)
    const v3 = await screen.findByRole('group', { name: 'Version 3' })
    expect(v3.textContent).toMatch(/\(current\)/)
    expect(v3.textContent).toMatch(/Changed: wording/)
    expect(screen.getByRole('group', { name: 'Version 2' }).textContent).toMatch(/Changed: wording, explanation/)
    expect(screen.getByRole('group', { name: 'Version 1' }).textContent).toMatch(/First version/)
    expect(within(v3).queryByRole('button', { name: /Put back/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Put back version 1' }))
    await user.click(screen.getByRole('button', { name: 'Put it back' }))
    await screen.findByText(/Version 1 is back as your current wording/)
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_questions')[0].stem).toBe('First wording'))
    await waitFor(() => expect(rows('user_questions')[0].current_version).toBe(4))
  })

  it('says so when offline, and shows the versions after trying again online', async () => {
    const q = seedQuestion('Only wording')
    server.versions.set(q.id, [V(1, 'Only wording')])
    mount('/app/workspace/questions')
    await screen.findByText('Only wording')
    server.down = true
    await user.click(screen.getByRole('link', { name: /^History: Only wording/ }))
    expect((await screen.findAllByRole('alert')).map((a) => a.textContent).join(' ')).toMatch(/offline/i)
    server.down = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('group', { name: 'Version 1' })).textContent).toMatch(/First version/)
  })

  it('goes back to the list when the question does not exist', async () => {
    const m = mount('/app/workspace/questions/nope/history')
    await waitFor(() => expect(m.router.state.location.pathname).toBe('/app/workspace/questions'))
  })
})
