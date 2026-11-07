import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { addAttempt, loadAttempts, newAttemptId, resetAttemptCache } from '../practice/attempts'
import { loadUserData, resetUserDataCache, updateUserData } from '../userdata/store'
import { setNote, toggleBookmark } from '../userdata/model'
import { realContent } from './content'
import { TEST_USER_ID, renderApp } from './utils'

const questions = realContent().questions
const COR = '/app/practice/play?subject=anatomy&topic=anatomy-coronary-arteries&count=3&mode=all&timed=0&shuffleq=0&shuffleo=1&seed=abc'
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()
const seed = (questionId: string, isCorrect: boolean, when: string) =>
  addAttempt(TEST_USER_ID, { id: newAttemptId(), questionId, selectedOptionId: 'A', isCorrect, timeMs: 3000, mode: 'practice', attemptedAt: when, contentVersion: 'x' })
const stem = (id: string) => questions.find((q) => q.id === id)!.stem.slice(0, 30)
const optionText = (qid: string, which: 'correct' | 'wrong') => {
  const q = questions.find((x) => x.id === qid)!
  return q.options.find((x) => (which === 'correct' ? x.id === q.correctOptionId : x.id !== q.correctOptionId))!.text
}
const pick = async (text: string) => userEvent.click(await screen.findByRole('radio', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }))
const NOW = new Date().toISOString()

beforeEach(() => {
  localStorage.clear()
  resetAttemptCache()
  resetUserDataCache()
})

describe('study tools in the player', () => {
  it('bookmarks the question and keeps it after a reload', async () => {
    const { unmount } = renderApp(COR)
    const btn = await screen.findByRole('button', { name: /Bookmark/ })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(btn)
    expect(screen.getByRole('button', { name: /Bookmarked/ })).toHaveAttribute('aria-pressed', 'true')
    expect(loadUserData(TEST_USER_ID).bookmarks).toHaveLength(1)
    unmount()
    resetUserDataCache()
    renderApp(COR)
    expect(await screen.findByRole('button', { name: /Bookmarked/ })).toBeInTheDocument()
  })

  it('saves a private note and clears it when emptied', async () => {
    renderApp(COR)
    const box = await screen.findByLabelText('My note (private)')
    await userEvent.type(box, 'Left coronary supplies the LAD')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText('Note saved.')).toBeInTheDocument()
    expect(loadUserData(TEST_USER_ID).notes[0].body).toBe('Left coronary supplies the LAD')
    await userEvent.clear(box)
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(await screen.findByText('Note removed.')).toBeInTheDocument()
    expect(loadUserData(TEST_USER_ID).notes).toEqual([])
  })

  it('reports a problem once per reason and lets the student withdraw it', async () => {
    renderApp(COR)
    await userEvent.click(await screen.findByRole('button', { name: 'Report a problem' }))
    await userEvent.selectOptions(screen.getByLabelText('What is wrong?'), 'typo')
    await userEvent.type(screen.getByLabelText('Comment (optional)'), 'stem has a typo')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
    const list = await screen.findByRole('list', { name: 'Your reports on this question' })
    expect(within(list).getByText('Spelling or typing mistake')).toBeInTheDocument()
    expect(loadUserData(TEST_USER_ID).flags[0]).toMatchObject({ reason: 'typo', comment: 'stem has a typo' })
    await userEvent.click(screen.getByRole('button', { name: /Report a problem/ }))
    await userEvent.selectOptions(screen.getByLabelText('What is wrong?'), 'typo')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already reported')
    await userEvent.click(screen.getByRole('button', { name: /Withdraw report/ }))
    expect(loadUserData(TEST_USER_ID).flags).toEqual([])
  })

  it('records the confidence rating with the answer, and none when it is skipped', async () => {
    renderApp(COR)
    await userEvent.click(await screen.findByRole('radio', { name: 'Fairly sure' }))
    await pick(optionText('demo-anat-cor-001', 'correct'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('Correct')
    expect(loadAttempts(TEST_USER_ID)[0].confidence).toBe(4)
    await userEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(screen.getByRole('radio', { name: 'Fairly sure' })).not.toBeChecked() // resets for each question
    await pick(questions.find((q) => q.id !== 'demo-anat-cor-001' && q.topicId === 'anatomy-coronary-arteries')!.options[0].text)
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByRole('heading', { name: 'Explanation' })
    expect(loadAttempts(TEST_USER_ID)[1].confidence).toBeUndefined()
  })
})

describe('bookmarked and revision-due practice modes', () => {
  it('practises only bookmarked questions', async () => {
    updateUserData(TEST_USER_ID, (d) => toggleBookmark(d, 'demo-anat-cor-002', NOW))
    renderApp('/app/practice/play?subject=anatomy&count=10&mode=bookmarked&shuffleq=0&seed=s')
    expect(await screen.findByTestId('progress-text')).toHaveTextContent('Question 1 of 1')
  })
  it('shows an empty state when nothing is bookmarked', async () => {
    renderApp('/app/practice/play?subject=anatomy&mode=bookmarked&seed=s')
    expect(await screen.findByText('No questions match')).toBeInTheDocument()
  })
  it('practises only questions whose review date has arrived, and logs them as revision', async () => {
    seed('demo-anat-cor-001', true, daysAgo(10)) // 1 day interval -> long overdue
    seed('demo-anat-cor-002', true, NOW) // due tomorrow, not yet
    renderApp('/app/practice/play?subject=anatomy&count=10&mode=due&shuffleq=0&seed=s')
    expect(await screen.findByTestId('progress-text')).toHaveTextContent('Question 1 of 1')
    await pick(optionText('demo-anat-cor-001', 'correct'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('Correct')
    expect(loadAttempts(TEST_USER_ID).at(-1)?.mode).toBe('revision')
  })
})

describe('revision, notebook and bookmarks pages', () => {
  it('revision page counts due and scheduled questions', async () => {
    seed('demo-anat-cor-001', false, daysAgo(2)) // wrong -> due 1 day after -> overdue
    seed('demo-anat-cor-002', true, NOW)
    renderApp('/app/revision')
    expect(await screen.findByRole('heading', { name: 'Revision' })).toBeInTheDocument()
    expect(screen.getByText('Due now').parentElement).toHaveTextContent('1')
    expect(screen.getByText('Scheduled later').parentElement).toHaveTextContent('1')
    const list = screen.getByRole('list', { name: 'Questions due for revision' })
    expect(list).toHaveTextContent(stem('demo-anat-cor-001'))
    expect(list).not.toHaveTextContent(stem('demo-anat-cor-002'))
    expect(screen.getByRole('link', { name: /Start revision/ })).toHaveAttribute('href', expect.stringContaining('mode=due'))
  })
  it('revision page explains the empty state honestly', async () => {
    renderApp('/app/revision')
    expect(await screen.findByText('Nothing due')).toBeInTheDocument()
    expect(screen.getByText(/Answer some questions/)).toBeInTheDocument()
  })
  it('notebook lists last-wrong questions with the note and drops a question once answered right', async () => {
    seed('demo-anat-cor-001', false, daysAgo(1))
    seed('demo-anat-cor-002', false, daysAgo(1))
    seed('demo-anat-cor-002', true, NOW) // recovered
    updateUserData(TEST_USER_ID, (d) => setNote(d, 'demo-anat-cor-001', 'mnemonic: RCA for SA node', NOW))
    renderApp('/app/notebook')
    const wrong = await screen.findByRole('list', { name: 'Incorrect questions' })
    expect(wrong).toHaveTextContent(stem('demo-anat-cor-001'))
    expect(wrong).toHaveTextContent('mnemonic: RCA for SA node')
    expect(wrong).toHaveTextContent('Wrong 1 of 1 time')
    expect(wrong).not.toHaveTextContent(stem('demo-anat-cor-002'))
    expect(screen.getByRole('list', { name: 'Questions with notes' })).toHaveTextContent('mnemonic')
  })
  it('bookmarks page: create a collection, file a bookmark, filter, delete the collection and keep the bookmark', async () => {
    updateUserData(TEST_USER_ID, (d) => toggleBookmark(d, 'demo-anat-cor-001', NOW))
    renderApp('/app/bookmarks')
    await userEvent.type(await screen.findByLabelText('New collection name'), 'Cardio')
    await userEvent.click(screen.getByRole('button', { name: 'Add collection' }))
    await userEvent.selectOptions(screen.getByLabelText('Collection for this question'), 'Cardio')
    expect(loadUserData(TEST_USER_ID).bookmarks[0].collectionId).toBe(loadUserData(TEST_USER_ID).collections[0].id)
    await userEvent.click(screen.getByRole('button', { name: 'Unfiled' }))
    expect(screen.queryByRole('list', { name: 'Bookmarked questions' })).not.toBeInTheDocument()
    expect(screen.getByText('No bookmarks in this view.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cardio' }))
    expect(screen.getByRole('list', { name: 'Bookmarked questions' })).toHaveTextContent(stem('demo-anat-cor-001'))
    await userEvent.click(screen.getByRole('button', { name: /Delete this collection/ }))
    expect(loadUserData(TEST_USER_ID).collections).toEqual([])
    expect(loadUserData(TEST_USER_ID).bookmarks).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /Remove bookmark/ }))
    expect(await screen.findByText('No bookmarks yet')).toBeInTheDocument()
  })
  it('duplicate collection names are rejected with a message', async () => {
    renderApp('/app/bookmarks')
    for (let i = 0; i < 2; i++) {
      await userEvent.type(await screen.findByLabelText('New collection name'), 'Same')
      await userEvent.click(screen.getByRole('button', { name: 'Add collection' }))
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('already have a collection')
  })
  it('dashboard shows the number of questions due', async () => {
    seed('demo-anat-cor-001', false, daysAgo(2))
    renderApp('/app')
    const stat = (await screen.findByText('Due revisions')).parentElement!
    expect(stat).toHaveTextContent('1')
  })
})
