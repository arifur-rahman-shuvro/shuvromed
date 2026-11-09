import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../App'
import { ServerClientsContext, type AdminClient, type FlagRow, type ServerClients } from '../account/clients'
import { AuthProvider } from '../auth/AuthContext'
import { buildExport, exportToText } from '../backup/export'
import { ContentClientContext } from '../data/ContentContext'
import { getDailyGoal } from '../prefs/settings'
import { addAttempt, loadAttempts, resetAttemptCache, type Attempt } from '../practice/attempts'
import { addCollection, emptyUserData, setNote, toggleBookmark, type UserData } from '../userdata/model'
import { loadUserData, saveUserData } from '../userdata/store'
import { resetMockCache } from '../mock/store'
import { makeFakeAuth } from './fakeAuthClient'
import { TEST_USER_ID, realContentClient } from './utils'

const downloads: { name: string; text: string; mime: string }[] = []
vi.mock('../lib/download', async (orig) => ({ ...(await orig<typeof import('../lib/download')>()), downloadText: (name: string, text: string, mime: string) => { downloads.push({ name, text, mime }) } }))

const T = '2026-11-07T05:00:00.000Z'
const att = (n: number): Attempt => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, questionId: 'demo-anat-cor-001', selectedOptionId: 'A', isCorrect: true, timeMs: 5000, mode: 'practice', attemptedAt: T, contentVersion: 'v' })

function open(path: string, clients: Partial<ServerClients> = {}) {
  const fake = makeFakeAuth({ signedInAs: 'me@test.local' })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <ContentClientContext.Provider value={realContentClient()}>
      <ServerClientsContext.Provider value={{ account: null, admin: null, ...clients }}>
        <AuthProvider client={fake.client}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ServerClientsContext.Provider>
    </ContentClientContext.Provider>,
  )
  return { router, fake, view }
}
const seed = () => {
  let d: UserData = emptyUserData()
  d = toggleBookmark(d, 'demo-anat-cor-001', T)
  d = (setNote(d, 'demo-anat-cor-001', 'my note', T) as { data: UserData }).data
  d = (addCollection(d, 'Cardio', '11111111-1111-4111-8111-111111111111', T) as { data: UserData }).data
  saveUserData(TEST_USER_ID, d)
  addAttempt(TEST_USER_ID, att(1)); addAttempt(TEST_USER_ID, att(2))
}
const upload = async (text: string, name = 'backup.json') => userEvent.upload(screen.getByLabelText('Restore from a backup file'), new File([text], name, { type: 'application/json' }))

describe('settings page', () => {
  beforeEach(() => { localStorage.clear(); resetAttemptCache(); resetMockCache(); downloads.length = 0 })

  it('daily goal can be emptied and retyped, is saved, and is what the dashboard shows', async () => {
    const { router } = open('/app/settings')
    const goal = await screen.findByLabelText(/Daily goal/)
    await userEvent.clear(goal)
    await userEvent.type(goal, '35')
    expect(goal).toHaveValue(35)
    expect(getDailyGoal(TEST_USER_ID)).toBe(35)
    await router.navigate('/app/legacy')
    expect(await screen.findByText(/\/ 35 questions/)).toBeInTheDocument()
  })

  it('downloads a backup that can be read back, and a CSV', async () => {
    seed()
    open('/app/settings')
    await userEvent.click(await screen.findByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].name).toMatch(/^shuvromed-backup-\d{8}\.json$/)
    const file = JSON.parse(downloads[0].text)
    expect(file.data.attempts).toHaveLength(2)
    expect(file.data.notes[0].body).toBe('my note')
    expect(downloads[0].text).not.toContain('me@test.local')
    await userEvent.click(screen.getByRole('button', { name: 'Download answers (CSV)' }))
    expect(downloads[1].name).toMatch(/^shuvromed-answers-\d{8}\.csv$/)
    expect(downloads[1].text.trim().split('\r\n')).toHaveLength(3)
  })

  it('restore: refuses a damaged file with a reason and changes nothing', async () => {
    seed()
    open('/app/settings')
    await screen.findByLabelText('Restore from a backup file')
    const good = JSON.parse(exportToText(await buildExport({ attempts: [att(9)], userData: emptyUserData(), mockResults: [], settings: {} })))
    good.data.attempts[0].isCorrect = false // edited after the checksum was made
    await upload(JSON.stringify(good))
    expect(await screen.findByRole('alert')).toHaveTextContent(/checksum|damaged/)
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(2)
    await upload('not json at all')
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a ShuvroMed backup/)
  })

  it('restore: shows what will be added, adds only what is missing, and a second restore adds nothing', async () => {
    seed()
    const file = await buildExport({ attempts: [att(1), att(7)], userData: loadUserData(TEST_USER_ID), mockResults: [], settings: {} })
    open('/app/settings')
    await screen.findByLabelText('Restore from a backup file')
    await upload(exportToText(file))
    expect(await screen.findByText(/Ready to restore from backup.json/)).toBeInTheDocument()
    expect(screen.getByText('Answers').parentElement).toHaveTextContent('1 new · 1 already here')
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(2) // nothing changed before confirming
    await userEvent.click(screen.getByRole('button', { name: 'Restore now' }))
    expect(await screen.findByLabelText('Restore result')).toBeInTheDocument()
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(3)
    await upload(exportToText(file))
    expect(await screen.findByText('Answers')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore now' }))
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(3)
    expect(within(screen.getByLabelText('Restore result')).getByText('Answers').parentElement).toHaveTextContent('0 new · 2 already here')
  })

  it('delete account: needs the word DELETE, keeps data if the server refuses, wipes this device and leaves if it succeeds', async () => {
    seed()
    const fail = vi.fn().mockResolvedValue({ error: 'network down' })
    const first = open('/app/settings', { account: { deleteMyAccount: fail } })
    await userEvent.click(await screen.findByRole('button', { name: /Delete my account/ }))
    const go = screen.getByRole('button', { name: 'Delete everything' })
    expect(go).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Type DELETE/), 'delete')
    expect(go).toBeDisabled() // case matters
    await userEvent.clear(screen.getByLabelText(/Type DELETE/))
    await userEvent.type(screen.getByLabelText(/Type DELETE/), 'DELETE')
    await userEvent.click(go)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not deleted: network down/)
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(2)
    first.view.unmount()

    const ok = vi.fn().mockResolvedValue({ error: null })
    const second = open('/app/settings', { account: { deleteMyAccount: ok } })
    await userEvent.click(await screen.findByRole('button', { name: /Delete my account/ }))
    await userEvent.type(screen.getByLabelText(/Type DELETE/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/'))
    expect(ok).toHaveBeenCalledTimes(1)
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(0)
    expect(loadUserData(TEST_USER_ID).notes).toHaveLength(0)
  })

  it('the Admin link is shown only to admins', async () => {
    const mk = (yes: boolean): AdminClient => ({ isAdmin: async () => yes, listFlags: async () => ({ rows: [], error: null }), setFlagStatus: async () => ({ error: null }), listBackups: async () => ({ rows: [], error: null }) })
    const a = open('/app/settings', { admin: mk(false) })
    await screen.findByRole('heading', { name: 'Settings' })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('link', { name: 'Admin area' })).not.toBeInTheDocument()
    a.view.unmount()
    open('/app/settings', { admin: mk(true) })
    expect(await screen.findByRole('link', { name: 'Admin area' })).toBeInTheDocument()
  })
})

describe('admin page', () => {
  beforeEach(() => { localStorage.clear(); resetAttemptCache() })
  const flag = (id: string, status: FlagRow['status']): FlagRow => ({ id, questionId: `q-${id}`, reason: 'typo', comment: 'stem has a typo', status, createdAt: T })

  it('a non-admin sees no access and no data is requested', async () => {
    const listFlags = vi.fn()
    open('/app/admin', { admin: { isAdmin: async () => false, listFlags, setFlagStatus: vi.fn(), listBackups: vi.fn() } })
    expect(await screen.findByText('No access')).toBeInTheDocument()
    expect(listFlags).not.toHaveBeenCalled()
  })

  it('an admin sees reports (open first), can resolve one, and sees honest backup information', async () => {
    let rows = [flag('1', 'resolved'), flag('2', 'open')]
    const client: AdminClient = {
      isAdmin: async () => true,
      listFlags: async () => ({ rows: [...rows], error: null }),
      setFlagStatus: async (id, status) => { rows = rows.map((r) => (r.id === id ? { ...r, status } : r)); return { error: null } },
      listBackups: async () => ({ rows: [], error: null }),
    }
    open('/app/admin', { admin: client })
    expect(await screen.findByRole('heading', { name: /Question reports \(1 open\)/ })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('q-2')
    await userEvent.click(within(items[0]).getByRole('button', { name: 'Mark resolved' }))
    expect(await screen.findByRole('heading', { name: /Question reports \(0 open\)/ })).toBeInTheDocument()
    expect(screen.getByText(/No backup has been recorded here/)).toBeInTheDocument()
  })

  it('shows the database refusal instead of pretending when updating fails', async () => {
    const client: AdminClient = { isAdmin: async () => true, listFlags: async () => ({ rows: [flag('1', 'open')], error: null }), setFlagStatus: async () => ({ error: 'permission denied' }), listBackups: async () => ({ rows: [], error: null }) }
    open('/app/admin', { admin: client })
    await userEvent.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  })
})
