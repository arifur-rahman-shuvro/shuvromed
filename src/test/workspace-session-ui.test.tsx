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
let subjectId = ''
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
const SBA = { options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], correct_option_id: 'a' }
function seed(stem: string) {
  const q = server.externalInsert('user_questions', {
    subject_id: subjectId, question_type: 'SBA', stem, difficulty: null, content: SBA, explanation: 'Because alpha.', reference: null,
    archived_at: null, deleted_at: null, current_version: 1,
  })
  server.versions.set(q.id, [{ version: 1, question_type: 'SBA', stem, difficulty: null, content: SBA, explanation: null, reference: null, subject_id: subjectId, subject_name: 'Anatomy', created_at: q.updated_at }])
  return q
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  server = fakeServer(); factory = new IDBFactory()
  subjectId = server.externalInsert('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null }).id
})

describe('practice and exams', () => {
  it('runs a practice session with immediate feedback and lands on the result', async () => {
    seed('First question'); seed('Second question')
    mount('/app/workspace/practice')
    await screen.findByText('2 questions available.')
    await user.click(screen.getByRole('button', { name: 'Start practice' }))
    await screen.findByText(/Question 1 of 2/)
    await user.click(screen.getByLabelText(/Alpha/))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText('Correct')).toBeTruthy()
    expect(screen.getByText(/Because alpha/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByLabelText('Score')).toBeTruthy()
    expect(screen.getByLabelText('Score').textContent).toContain('1 / 2')
  })

  it('runs an exam: no feedback until submit, confirms unanswered, shows the result', async () => {
    seed('First question'); seed('Second question')
    mount('/app/workspace/practice')
    await screen.findByText('2 questions available.')
    await user.click(screen.getByLabelText(/^Exam/))
    await user.click(screen.getByRole('button', { name: 'Start exam' }))
    await screen.findByText(/Question 1 of 2/)
    await user.click(screen.getByLabelText(/Beta/))
    expect(screen.queryByText('Incorrect')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check answer' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Submit exam' }))
    expect(screen.getByText(/1 question will be marked as not answered/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Yes, submit' }))
    const score = await screen.findByLabelText('Score')
    expect(score.textContent).toContain('/ 2')
    expect(screen.getByText(/1 incorrect/)).toBeTruthy()
    expect(screen.getByText(/1 not answered/)).toBeTruthy()
    // The missed ones can be practised again.
    expect(screen.getByRole('button', { name: /Practise the 2 questions I missed/ })).toBeTruthy()
  })

  it('shows a paused session in the history and continues it', async () => {
    seed('First question')
    mount('/app/workspace/practice')
    await screen.findByText('1 question available.')
    await user.click(screen.getByRole('button', { name: 'Start practice' }))
    await screen.findByText(/Question 1 of 1/)
    await user.click(screen.getByRole('button', { name: 'Pause and leave' }))
    expect(await screen.findByText('Not finished')).toBeTruthy()
    await user.click(screen.getByRole('link', { name: /^Continue/ }))
    await screen.findByText(/Question 1 of 1/)
  })

  it('saves an exam set-up and starts it again from the list', async () => {
    seed('First question')
    mount('/app/workspace/practice')
    await screen.findByText('1 question available.')
    await user.click(screen.getByLabelText(/^Exam/))
    await user.click(screen.getByRole('button', { name: 'Save as a repeatable exam' }))
    await user.type(screen.getByLabelText('Name for this exam'), 'Mock A')
    await user.click(screen.getByRole('button', { name: 'Save exam' }))
    await screen.findByText('Mock A')
    await user.click(screen.getByRole('button', { name: 'Start exam: Mock A' }))
    await screen.findByText(/Question 1 of 1/)
  })

  it('syncs the finished exam and its answers once the server has the tables', async () => {
    seed('First question')
    mount('/app/workspace/practice')
    await screen.findByText('1 question available.')
    await user.click(screen.getByLabelText(/^Exam/))
    await user.click(screen.getByRole('button', { name: 'Start exam' }))
    await user.click(await screen.findByLabelText(/Alpha/))
    await user.click(screen.getByRole('button', { name: 'Submit exam' }))
    await user.click(screen.getByRole('button', { name: 'Yes, submit' }))
    await screen.findByLabelText('Score')
    await waitFor(() => expect([...(server.tables.get('user_question_attempts')?.values() ?? [])].length).toBe(1), { timeout: 4000 })
    expect([...(server.tables.get('user_sessions')?.values() ?? [])][0].status).toBe('finished')
  })

  it('tells you when there are no questions yet', async () => {
    mount('/app/workspace/practice')
    expect(await screen.findByText('No questions yet')).toBeTruthy()
  })
})
