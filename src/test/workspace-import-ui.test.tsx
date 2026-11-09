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
  server = fakeServer()
  factory = new IDBFactory()
  server.externalInsert('user_subjects', { name: 'Anatomy', description: null, sort_order: 0, archived_at: null })
})




const SBA = `Subject: Anatomy
Topic: Thorax > Heart
Exam: FCPS Part 1
Q: Which valve lies between the left atrium and ventricle?
A) Tricuspid
B) Mitral *
C) Aortic`

async function paste(text: string) {
  const box = await screen.findByLabelText('Paste questions here')
  await user.click(box)
  await user.paste(text)
}

describe('Import and export screen', () => {
  it('checks first, saves nothing until Import, then lists the questions and syncs them', async () => {
    mount('/app/workspace/import')
    await paste(SBA + '\n---\nQ: Four chambers?\nAnswer: True\n---\nQ: broken\nA) only *')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    const report = await screen.findByRole('region', { name: 'Import report' })
    expect(report.textContent).toMatch(/2 questions will be added/)
    expect(report.textContent).toMatch(/1 question with problems left out/)
    expect(report.textContent).toMatch(/Will also create: 2 topics, 1 tag\./)
    expect(report.textContent).toMatch(/at least 2 options/)
    expect(rows('user_questions')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Import 2 questions' }))
    await screen.findByText('Imported 2 questions.')
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(rows('user_questions')).toHaveLength(2))
    expect(rows('user_tags').map((r) => r.name)).toEqual(['FCPS Part 1'])
    await user.click(screen.getByRole('link', { name: 'Open My questions' }))
    expect(await screen.findByText('Four chambers?')).toBeTruthy()
  })

  it('reports duplicates and offers to add them anyway', async () => {
    mount('/app/workspace/import')
    await paste(SBA)
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(await screen.findByRole('button', { name: 'Import 1 question' }))
    await screen.findByText('Imported 1 question.')
    await paste(SBA)
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect((await screen.findByRole('region', { name: 'Import report' })).textContent).toMatch(/0 questions will be added, 1 duplicate skipped/)
    await user.click(screen.getByLabelText(/Add questions even if/))
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect((await screen.findByRole('region', { name: 'Import report' })).textContent).toMatch(/1 question will be added/)
  })

  it('reads a chosen .json file and reports a file that is not ours', async () => {
    mount('/app/workspace/import')
    const file = new File([JSON.stringify({ format: 'shuvromed-questions', version: 1, questions: [{ subject: 'Anatomy', type: 'TRUE_FALSE', stem: 'From a file?', content: { correct_answer: true } }] })], 'q.json', { type: 'application/json' })
    await user.upload(await screen.findByLabelText(/Or choose a file/), file)
    expect((await screen.findByRole('region', { name: 'Import report' })).textContent).toMatch(/1 question will be added/)
    await user.upload(screen.getByLabelText(/Or choose a file/), new File(['{"format":"other"}'], 'x.json', { type: 'application/json' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a ShuvroMed question file/)
  })

  it('exports every question as a downloadable file', async () => {
    const created: Blob[] = []
    URL.createObjectURL = (b: Blob | MediaSource) => { created.push(b as Blob); return 'blob:test' }
    URL.revokeObjectURL = () => undefined
    mount('/app/workspace/import')
    await paste(SBA)
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await user.click(await screen.findByRole('button', { name: 'Import 1 question' }))
    await screen.findByText('Imported 1 question.')
    await user.click(screen.getByRole('button', { name: 'Download all my questions' }))
    await screen.findByText(/Exported 1 question/)
    const data = JSON.parse(await created[0].text())
    expect(data).toMatchObject({ format: 'shuvromed-questions', version: 1 })
    expect(data.questions[0]).toMatchObject({ subject: 'Anatomy', exam_tags: ['FCPS Part 1'], topics: [['Thorax', 'Heart']] })
  })

  it('shows the prompt kit and copies it', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { written.push(t) } }, configurable: true })
    mount('/app/workspace/import')
    expect(await screen.findByText(/Turn the study notes I give you/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy prompt' }))
    await screen.findByText(/Copied\./)
    expect(written[0]).toMatch(/^Turn the study notes/)
  })

  it('hides the screen until the workspace is switched on', async () => {
    localStorage.clear()
    const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
    const router = createMemoryRouter(routes, { initialEntries: ['/app/workspace/import'] })
    render(
      <ContentClientContext.Provider value={realContentClient()}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </ContentClientContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    expect(router.state.location.pathname).toBe('/app/settings')
  })
})
