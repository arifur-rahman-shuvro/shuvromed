import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../App'
import { AuthProvider } from '../auth/AuthContext'
import { setWorkspaceEnabled } from '../workspace/flag'
import { WorkspaceRepoContext, type WorkspaceRepo } from '../workspace/repo'
import { buildTopicTree, deleteRefusal, descendantIds, moveTargets, normName, validateName, type WTopic } from '../workspace/model'
import { makeFakeAuth } from './fakeAuthClient'
import { memoryWorkspace } from './memoryWorkspace'
import { TEST_USER_ID, realContentClient } from './utils'
import { ContentClientContext } from '../data/ContentContext'

const T = (id: string, name: string, parentId: string | null = null, subjectId = 's'): WTopic => ({ id, subjectId, parentId, name, archived: false, rowVersion: 1 })

describe('workspace model helpers', () => {
  it('normalises names like the database does', () => {
    expect(normName('  Heart   Failure ')).toBe('heart failure')
  })
  it('validates names', () => {
    expect(validateName('  ', 10, [])).toBe('Enter a name.')
    expect(validateName('x'.repeat(11), 10, [])).toMatch(/10 characters/)
    expect(validateName(' a  b ', 10, [{ id: '1', name: 'A B' }])).toMatch(/already used/)
    expect(validateName('A B', 10, [{ id: '1', name: 'a b' }], '1')).toBeNull()
  })
  it('builds a sorted nested tree, hides archived unless asked, never loses orphans', () => {
    const topics = [T('b', 'Beta'), T('a', 'Alpha'), T('a1', 'Child', 'a'), { ...T('z', 'Old'), archived: true }, T('o', 'Orphan', 'missing')]
    const tree = buildTopicTree(topics, 's', false)
    expect(tree.map((n) => n.name)).toEqual(['Alpha', 'Beta', 'Orphan'])
    expect(tree[0].children[0]).toMatchObject({ name: 'Child', depth: 1 })
    expect(buildTopicTree(topics, 's', true).map((n) => n.name)).toContain('Old')
  })
  it('never offers a topic or its descendants as a move target', () => {
    const topics = [T('a', 'A'), T('b', 'B', 'a'), T('c', 'C', 'b'), T('d', 'D')]
    expect([...descendantIds(topics, 'a')].sort()).toEqual(['b', 'c'])
    expect(moveTargets(topics, topics[0]).map((t) => t.id)).toEqual(['d'])
    expect(moveTargets(topics, topics[1]).map((t) => t.id)).toEqual(['a', 'd'])
  })
  it('refuses deleting anything that still has content', () => {
    expect(deleteRefusal('subject', { topics: 2, questions: 1 })).toMatch(/2 topics and 1 question/)
    expect(deleteRefusal('topic', { questions: 0 })).toBeNull()
  })
})

function open(repo: WorkspaceRepo, path = '/app/workspace/subjects', enabled = true) {
  localStorage.clear()
  if (enabled) setWorkspaceEnabled(TEST_USER_ID, true)
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ContentClientContext.Provider value={realContentClient()}>
      <WorkspaceRepoContext.Provider value={repo}>
        <AuthProvider client={fake.client}><RouterProvider router={router} /></AuthProvider>
      </WorkspaceRepoContext.Provider>
    </ContentClientContext.Provider>,
  )
  return router
}

describe('My subjects page', () => {
  beforeEach(() => localStorage.clear())

  it('is hidden until switched on: redirects to Settings', async () => {
    const router = open(memoryWorkspace(), '/app/workspace/subjects', false)
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    expect(router.state.location.pathname).toBe('/app/settings')
  })

  it('Settings toggle reveals the link; new account starts empty', async () => {
    open(memoryWorkspace(), '/app/settings', false)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Show my private workspace' }))
    await userEvent.click(await screen.findByRole('link', { name: 'Open My subjects' }))
    await screen.findByRole('heading', { name: 'My subjects', level: 1 })
    expect(await screen.findByText('No subjects yet')).toBeTruthy()
  })

  it('adds, renames, archives and deletes a subject; rejects duplicates', async () => {
    open(memoryWorkspace())
    const box = await screen.findByLabelText('New subject name')
    await userEvent.type(box, 'Anatomy')
    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }))
    await screen.findByRole('heading', { name: 'Anatomy', level: 2 })
    await userEvent.type(box, ' anatomy ')
    await userEvent.click(screen.getByRole('button', { name: 'Add subject' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already used/)

    await userEvent.click(screen.getByRole('button', { name: 'Rename Anatomy' }))
    const rename = screen.getByLabelText('New name')
    await userEvent.clear(rename)
    await userEvent.type(rename, 'Gross Anatomy')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await screen.findByRole('heading', { name: 'Gross Anatomy', level: 2 })

    await userEvent.click(screen.getByRole('button', { name: 'Archive Gross Anatomy' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Gross Anatomy/ })).toBeNull())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await screen.findByRole('heading', { name: /Gross Anatomy \(archived\)/ })

    await userEvent.click(screen.getByRole('button', { name: 'Delete Gross Anatomy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete “Gross Anatomy”' }))
    await screen.findByText('No subjects yet')
  })

  it('builds nested topics, moves one, and refuses to delete a subject that has content', async () => {
    const repo = memoryWorkspace({ subjects: [{ id: 'x', name: 'Physiology', description: null, archived: false, rowVersion: 1 }], questionsBySubject: { x: 3 } })
    open(repo)
    await userEvent.click(await screen.findByRole('button', { name: 'Show topics of Physiology' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add topic to Physiology' }))
    await userEvent.type(screen.getByLabelText('Topic name'), 'Cardio')
    await userEvent.click(screen.getByRole('button', { name: 'Add topic' }))
    await screen.findByText('Cardio')
    await userEvent.click(screen.getByRole('button', { name: 'Add sub-topic to Cardio' }))
    await userEvent.type(screen.getByLabelText('Sub-topic name'), 'Heart')
    await userEvent.click(screen.getByRole('button', { name: 'Add sub-topic' }))
    await screen.findByText('Heart')
    expect(repo.topics.find((t) => t.name === 'Heart')?.parentId).toBe(repo.topics.find((t) => t.name === 'Cardio')?.id)

    await userEvent.click(screen.getByRole('button', { name: 'Move Heart' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move here' })) // default target: top level
    await waitFor(() => expect(repo.topics.find((t) => t.name === 'Heart')?.parentId).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Delete Physiology' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete “Physiology”' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/2 topics and 3 questions/)
    expect(repo.subjects).toHaveLength(1)
  })

  it('shows a clear message and a retry when the server is not ready', async () => {
    const repo = memoryWorkspace()
    repo.load = async () => ({ data: null, error: 'Your private workspace is not set up on the server yet.' })
    open(repo)
    const alert = await screen.findByRole('alert')
    expect(within(alert.parentElement as HTMLElement).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(alert.textContent).toMatch(/not set up/)
  })
})
