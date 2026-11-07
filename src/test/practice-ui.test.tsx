import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBundle } from '../content/bundle'
import { createContentClient } from '../data/loader'
import { addAttempt, loadAttempts, newAttemptId, resetAttemptCache } from '../practice/attempts'
import { configToParams, paramsToConfig } from '../practice/params'
import { DEFAULT_CONFIG } from '../practice/session'
import { computeStreak, getDashboardStats, localDay } from '../lib/stats'
import { bundleFetcher, fakeHash, realBundle, realContent } from './content'
import { TEST_USER_ID, renderApp } from './utils'

const COR = '/app/practice/play?subject=anatomy&topic=anatomy-coronary-arteries&count=3&mode=all&timed=0&shuffleq=0&shuffleo=1&seed=abc'
const questions = realContent().questions

beforeEach(() => {
  localStorage.clear()
  resetAttemptCache()
  vi.restoreAllMocks()
})

const optionText = (qid: string, which: 'correct' | 'wrong') => {
  const q = questions.find((x) => x.id === qid)!
  const o = q.options.find((x) => (which === 'correct' ? x.id === q.correctOptionId : x.id !== q.correctOptionId))!
  return o.text
}
const pick = async (text: string) => userEvent.click(await screen.findByRole('radio', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }))

describe('subjects', () => {
  it('lists every subject from data, with question counts and the DEMO banner', async () => {
    renderApp('/app/subjects')
    expect(await screen.findByRole('heading', { name: 'Subjects' })).toBeInTheDocument()
    expect(screen.getByText(/DEMO content/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('a[href^="/app/subjects/"]'))).toHaveLength(15)
    expect(within(screen.getByRole('link', { name: /Anatomy/ })).getByText('4 questions')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: /Surgery/ })).getByText('No questions yet')).toBeInTheDocument()
  })
  it('searches subjects and shows an empty state when nothing matches', async () => {
    renderApp('/app/subjects')
    await userEvent.type(await screen.findByLabelText('Search subjects'), 'pharm')
    expect(screen.getByRole('link', { name: /Pharmacology/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Anatomy/ })).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search subjects'))
    await userEvent.type(screen.getByLabelText('Search subjects'), 'zzzz')
    expect(screen.getByText('No subjects match')).toBeInTheDocument()
  })
  it('shows an error with a working retry when content cannot be loaded', async () => {
    let down = true
    const good = bundleFetcher(realBundle())
    const content = createContentClient(async (p) => {
      if (down) throw new Error('Could not load manifest.json (HTTP 503)')
      return good(p)
    })
    renderApp('/app/subjects', undefined, undefined, content)
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503')
    down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Subjects' })).toBeInTheDocument()
  })
})

describe('topic library', () => {
  it('shows the Anatomy > Thorax > Heart > Coronary arteries hierarchy with real stats', async () => {
    renderApp('/app/subjects/anatomy')
    expect(await screen.findByRole('heading', { name: 'Anatomy' })).toBeInTheDocument()
    for (const name of ['Thorax', 'Heart', 'Coronary arteries', 'Cardiac chambers and valves']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    const cor = screen.getByRole('region', { name: 'Coronary arteries' })
    expect(cor).toHaveTextContent('3 questions')
    expect(cor).toHaveTextContent('Attempted 0/3')
    expect(cor).toHaveTextContent('Accuracy —')
    expect(cor).toHaveTextContent('Easy 1')
    expect(cor).toHaveTextContent('Medium 2')
    expect(screen.getByRole('region', { name: 'Heart' })).toHaveTextContent('4 questions') // includes children
    expect(within(cor).getByText('MBBS-style')).toBeInTheDocument()
  })
  it('updates attempted, accuracy and mastery from recorded answers', async () => {
    addAttempt(TEST_USER_ID, { id: newAttemptId(), questionId: 'demo-anat-cor-001', selectedOptionId: 'A', isCorrect: true, timeMs: 4000, mode: 'practice', attemptedAt: new Date().toISOString(), contentVersion: 'x' })
    renderApp('/app/subjects/anatomy')
    const cor = await screen.findByRole('region', { name: 'Coronary arteries' })
    expect(cor).toHaveTextContent('Attempted 1/3')
    expect(cor).toHaveTextContent('Accuracy 100%')
    expect(cor).toHaveTextContent('Mastery 33%')
  })
  it('shows an empty state for a subject with no topics and a not-found state for a bad id', async () => {
    const { unmount } = renderApp('/app/subjects/surgery')
    expect(await screen.findByText('No topics yet')).toBeInTheDocument()
    unmount()
    renderApp('/app/subjects/not-a-subject')
    expect(await screen.findByText('Subject not found')).toBeInTheDocument()
  })
})

const answerRadios = () => screen.getAllByRole('radio').filter((r) => r.getAttribute('name') === 'answer')

describe('practice setup', () => {
  it('prefills from the topic, counts matching questions live, and starts a session', async () => {
    renderApp('/app/practice?subject=anatomy&topic=anatomy-coronary-arteries')
    expect(await screen.findByLabelText('Subject')).toHaveValue('anatomy')
    expect(await screen.findByText(/3 matching questions; this session will use 3/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Difficulty'), 'easy')
    expect(await screen.findByText(/1 matching question; this session will use 1/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Difficulty'), '')
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }))
    expect(await screen.findByTestId('progress-text')).toHaveTextContent('Question 1 of 3')
  })
  it('disables Start when nothing matches, including the bookmark and revision modes when there are none', async () => {
    renderApp('/app/practice?subject=anatomy&mode=incorrect')
    expect(await screen.findByText('No questions match these settings.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText(/Only my bookmarked/))
    expect(await screen.findByText('No questions match these settings.')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Only questions due for revision/))
    expect(await screen.findByText('No questions match these settings.')).toBeInTheDocument()
  })
  it('filters by exam style', async () => {
    renderApp('/app/practice')
    await userEvent.selectOptions(await screen.findByLabelText('Exam style'), 'mrcs')
    expect(await screen.findByText(/1 matching question/)).toBeInTheDocument()
  })
})

describe('question player', () => {
  it('hides the answer until submit, then shows result, explanation, analysis, pearl and learning points', async () => {
    renderApp(COR)
    expect(await screen.findByTestId('progress-text')).toHaveTextContent('Question 1 of 3')
    expect(screen.getByText(/DEMO · unreviewed sample/)).toBeInTheDocument()
    expect(screen.queryByText('Explanation')).not.toBeInTheDocument()
    expect(screen.queryByText(/Correct answer/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
    expect(answerRadios()).toHaveLength(5)
    expect(screen.getAllByRole('radio', { name: /Guess|Unsure|Maybe|Fairly sure|Certain/ })).toHaveLength(5) // optional confidence

    await pick(optionText('demo-anat-cor-001', 'correct'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(await screen.findByText('Correct')).toBeInTheDocument()
    for (const h of ['Explanation', 'Why each option is right or wrong', 'Clinical pearl', 'Learning points']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    }
    expect(screen.getByText(/No references are attached/)).toBeInTheDocument() // honest: demo has none
    // disabled through the parent <fieldset disabled>, so the browser blocks them (matches :disabled)
    expect(answerRadios().every((r) => r.matches(':disabled'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Submit answer' })).not.toBeInTheDocument()
  })

  it('marks the right option after a wrong answer, even with options shuffled', async () => {
    renderApp(COR)
    await screen.findByTestId('progress-text')
    await pick(optionText('demo-anat-cor-001', 'wrong'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    const status = await screen.findByText(/^Incorrect\. The correct answer is [A-E]\.$/)
    const letter = /is ([A-E])\./.exec(status.textContent!)![1]
    const marked = screen.getByText('✓ Correct answer').closest('label')!
    expect(marked).toHaveTextContent(`${letter}.`)
    expect(marked).toHaveTextContent(optionText('demo-anat-cor-001', 'correct'))
    expect(screen.getByText('✗ Your answer')).toBeInTheDocument()
  })

  it('records each answer once on this device and updates the dashboard from it', async () => {
    const { unmount } = renderApp(COR)
    await screen.findByTestId('progress-text')
    await pick(optionText('demo-anat-cor-001', 'correct'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('Correct')
    const saved = loadAttempts(TEST_USER_ID)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ questionId: 'demo-anat-cor-001', isCorrect: true, selectedOptionId: expect.stringMatching(/^[A-E]$/) })
    unmount()
    renderApp('/app')
    const stats = await screen.findByRole('region', { name: 'Statistics' })
    expect(stats).toHaveTextContent('Answers recorded1')
    expect(stats).toHaveTextContent('Accuracy100%')
    expect(stats).toHaveTextContent('Streak1 day')
    expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent('1 answered · 1 correct')
  })

  it('runs a whole session to a scored summary and offers practise again', async () => {
    renderApp(COR)
    for (let i = 0; i < 3; i++) {
      await screen.findByText(`Question ${i + 1} of 3`)
      const id = ['demo-anat-cor-001', 'demo-anat-cor-002', 'demo-anat-cor-003'][i]
      // answer 1 and 2 correctly, 3 wrongly
      await pick(optionText(id, i < 2 ? 'correct' : 'wrong'))
      await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
      await screen.findByRole('heading', { name: 'Explanation' })
      if (i < 2) await userEvent.click(screen.getByRole('button', { name: 'Next question' }))
    }
    await userEvent.click(screen.getByRole('button', { name: 'Finish session' }))
    expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeInTheDocument()
    expect(screen.getByTestId('score')).toHaveTextContent('2 / 3')
    expect(screen.getByText(/67% overall/)).toBeInTheDocument()
    expect(screen.getByText(/1 incorrect · 0 skipped/)).toBeInTheDocument()
    expect(screen.getByText('Coronary arteries')).toBeInTheDocument()
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Practise again' })).toBeInTheDocument()
  })

  it('asks for confirmation before ending early and counts unanswered questions as skipped', async () => {
    renderApp(COR)
    await screen.findByTestId('progress-text')
    await pick(optionText('demo-anat-cor-001', 'correct'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Finish session' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('2 unanswered questions will count as skipped')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep practising' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finish session' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End session' }))
    expect(await screen.findByTestId('score')).toHaveTextContent('1 / 3')
    expect(screen.getByText(/0 incorrect · 2 skipped/)).toBeInTheDocument()
  })

  it('navigates back to an answered question and keeps it read-only', async () => {
    renderApp(COR)
    await screen.findByTestId('progress-text')
    await pick(optionText('demo-anat-cor-001', 'wrong'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next question' }))
    expect(screen.getByTestId('progress-text')).toHaveTextContent('Question 2 of 3')
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByTestId('progress-text')).toHaveTextContent('Question 1 of 3')
    expect(screen.getByRole('heading', { name: 'Explanation' })).toBeInTheDocument()
    expect(loadAttempts(TEST_USER_ID)).toHaveLength(1)
  })

  it('ends a timed session when the time limit passes', async () => {
    renderApp('/app/practice/play?subject=anatomy&topic=anatomy-coronary-arteries&count=2&timed=1&shuffleq=0&seed=t')
    expect(await screen.findByText(/left$/)).toHaveTextContent('3:00 left')
    const real = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(real + 10 * 60_000)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Session complete' })).toBeInTheDocument(), { timeout: 4000 })
    expect(screen.getByText(/Time ran out/)).toBeInTheDocument()
    expect(screen.getByTestId('score')).toHaveTextContent('0 / 2')
  })

  it('shows an empty state when no questions match the saved history', async () => {
    renderApp('/app/practice/play?subject=anatomy&mode=incorrect&seed=z')
    expect(await screen.findByText('No questions match')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change settings' })).toHaveAttribute('href', expect.stringContaining('/app/practice?'))
  })

  it('incorrect-only mode replays exactly the questions last answered wrong', async () => {
    addAttempt(TEST_USER_ID, { id: newAttemptId(), questionId: 'demo-anat-cor-002', selectedOptionId: 'B', isCorrect: false, timeMs: 1000, mode: 'practice', attemptedAt: new Date().toISOString(), contentVersion: 'x' })
    renderApp('/app/practice/play?subject=anatomy&mode=incorrect&count=10&seed=q')
    expect(await screen.findByTestId('progress-text')).toHaveTextContent('Question 1 of 1')
    expect(screen.getByRole('radio', { name: new RegExp(optionText('demo-anat-cor-002', 'correct').slice(0, 20)) })).toBeInTheDocument()
  })
})

describe('safe rendering (XSS)', () => {
  it('renders question text containing HTML as inert text', async () => {
    const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> Which artery is described here?'
    const content = realContent()
    content.questions = content.questions.map((q) => (q.id === 'demo-anat-cor-001' ? { ...q, stem: evil } : q))
    const bundle = buildBundle(content, { includeDemo: true }, fakeHash)
    const { container } = renderApp(COR, undefined, undefined, createContentClient(bundleFetcher(bundle)))
    expect(await screen.findByText(/Which artery is described here\?/)).toHaveTextContent('<img src=x onerror=')
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })
})

describe('URL parameters are untrusted input', () => {
  it('round-trips a config', () => {
    const cfg = { ...DEFAULT_CONFIG, subjectId: 'anatomy', topicId: 'anatomy-heart', examStyle: 'mrcs', difficulty: 'hard' as const, count: 25, mode: 'incorrect' as const, timed: true, shuffleQuestions: false, shuffleOptions: false }
    expect(paramsToConfig(configToParams(cfg, 'seed1'))).toEqual(cfg)
  })
  it('falls back to safe defaults for garbage', () => {
    const cfg = paramsToConfig(new URLSearchParams('difficulty=impossible&mode=hack&count=-5&timed=maybe&shuffleq=2'))
    expect(cfg).toMatchObject({ difficulty: null, mode: 'all', count: 1, timed: false, shuffleQuestions: true })
    expect(paramsToConfig(new URLSearchParams('count=abc')).count).toBe(10)
    expect(paramsToConfig(new URLSearchParams('count=99999')).count).toBe(100)
  })
})

describe('dashboard statistics', () => {
  const at = (iso: string, correct = true, ms = 60_000) => ({ id: newAttemptId(), questionId: 'q', selectedOptionId: 'A' as const, isCorrect: correct, timeMs: ms, mode: 'practice' as const, attemptedAt: iso, contentVersion: 'v' })
  it('streak counts consecutive local days and survives until a full day is missed', () => {
    const days = new Set(['2026-11-04', '2026-11-05', '2026-11-06'])
    expect(computeStreak(days, '2026-11-06')).toBe(3)
    expect(computeStreak(new Set(['2026-11-04', '2026-11-05']), '2026-11-06')).toBe(2) // today not over yet
    expect(computeStreak(new Set(['2026-11-03', '2026-11-04']), '2026-11-06')).toBe(0) // yesterday missed
    expect(computeStreak(new Set(['2026-11-06', '2026-11-04']), '2026-11-06')).toBe(1) // gap breaks it
    expect(computeStreak(new Set(['2026-02-28', '2026-03-01']), '2026-03-01')).toBe(2) // month boundary
    expect(computeStreak(new Set(), '2026-11-06')).toBe(0)
  })
  it('computes today-only figures; a repeated question earns XP once per day', () => {
    const now = new Date(2026, 10, 6, 15, 0, 0)
    const today = new Date(2026, 10, 6, 9, 0, 0).toISOString()
    const yesterday = new Date(2026, 10, 5, 9, 0, 0).toISOString()
    const todayLater = new Date(2026, 10, 6, 9, 5, 0).toISOString()
    const s = getDashboardStats([at(today), at(todayLater, false, 120_000), at(yesterday)], now, 20)
    expect(s).toMatchObject({ attempted: 3, correct: 2, answeredToday: 2, studyMinutesToday: 3, streakDays: 2, dueRevisions: 0, xp: 20, level: 1 }) // 10 (first answer today) + 0 (same question again today) + 10 (yesterday)
    expect(s.accuracyPct).toBeCloseTo(66.67, 1)
    expect(s.recentDays.map((d) => d.date)).toEqual([localDay(now), '2026-11-05'])
  })
  it('is all zeros and nulls with no attempts', () => {
    expect(getDashboardStats([], new Date())).toMatchObject({ attempted: 0, accuracyPct: null, streakDays: 0, answeredToday: 0, recentDays: [] })
  })
})
