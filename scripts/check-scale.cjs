/*
 * Real-browser scale check: 20,000 questions in the browser's real IndexedDB, then real screens timed with a 4x slower CPU
 * (roughly a mid-range phone). Two phases that share one browser profile on the SAME origin (IndexedDB belongs to an origin):
 *   1. `seed`    against `vite` (dev server) on the port: writes the data through the app's own storage code.
 *   2. `measure` against `vite preview` of a production build on the SAME port: opens the real screens and times them.
 *   node scripts/check-scale.cjs seed|measure <base-url> <profile-dir> [count]
 * Needs Playwright (not a project dependency). Uses a fake local session and blocks supabase.co, so the app is offline:
 * this measures the device, not the network. Build for the measure phase with VITE_SUPABASE_URL=https://example.supabase.co.
 */
const { chromium } = require('playwright')
const [mode, BASE, PROFILE, COUNT = '20000'] = process.argv.slice(2)
const N = Number(COUNT)
const uid = '11111111-1111-4111-8111-111111111111'
const out = []
const rec = (name, ms, note = '') => { out.push([name, ms]); console.log(`${String(Math.round(ms)).padStart(8)} ms  ${name}${note ? '  ' + note : ''}`) }

async function open(throttle) {
  const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })
  const now = Math.floor(Date.now() / 1000)
  const sess = { access_token: 'x.y.z', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'scale@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
  await ctx.route('**/*.supabase.co/**', (r) => r.abort())
  await ctx.addInitScript((s) => { try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)) } catch {} }, sess)
  const page = ctx.pages()[0] || (await ctx.newPage())
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)))
  if (throttle) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }) }
  return { ctx, page, errs }
}

async function seed() {
  const { ctx, page } = await open(0)
  await page.goto(`${BASE}/app`)
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor({ timeout: 60000 })
  const t0 = Date.now()
  const result = await page.evaluate(async ({ n, uid }) => {
    const { openIdbBackend } = await import('/src/workspace/store/idb.ts')
    const { WorkspaceStore } = await import('/src/workspace/store/store.ts')
    const { WORKSPACE_TABLES } = await import('/src/workspace/tables.ts')
    const { localWorkspaceRepo } = await import('/src/workspace/localRepo.ts')
    const { localQuestionRepo } = await import('/src/questions/repo.ts')
    const { localTagRepo } = await import('/src/tags/repo.ts')
    const { localSessionRepo } = await import('/src/session/repo.ts')
    const T = {}
    const time = async (k, f) => { const a = performance.now(); const r = await f(); T[k] = Math.round(performance.now() - a); return r }
    const store = new WorkspaceStore(await openIdbBackend(uid), WORKSPACE_TABLES)
    const ws = localWorkspaceRepo(store), qr = localQuestionRepo(store), tg = localTagRepo(store), ss = localSessionRepo(store)
    const subjects = []
    for (let i = 0; i < 12; i++) subjects.push((await ws.createSubject(`Subject ${i}`, null)).data)
    const topics = {}
    for (const s of subjects) { topics[s.id] = []; for (let j = 0; j < 10; j++) topics[s.id].push((await ws.createTopic(s.id, null, `Topic ${s.name}-${j}`)).data.id) }
    const tags = []
    for (let i = 0; i < 6; i++) tags.push((await tg.create(i < 3 ? 'exam' : 'general', `Tag ${i}`)).data.id)
    const inputs = Array.from({ length: n }, (_, i) => {
      const s = subjects[i % 12], kind = i % 3
      return { subjectId: s.id, type: kind === 0 ? 'SBA' : kind === 1 ? 'TRUE_FALSE' : 'FILL_GAP', difficulty: ['easy', 'medium', 'hard'][i % 3],
        stem: kind === 2 ? `Statement number ${i} about the {{b1}} of ${i % 7 === 0 ? 'valve' : 'kidney'}` : `Statement number ${i} about ${i % 7 === 0 ? 'valve' : 'kidney'}`,
        content: kind === 0 ? { options: [{ id: 'a', text: `Right ${i}` }, { id: 'b', text: `Wrong ${i}` }, { id: 'c', text: `Other ${i}` }], correct_option_id: 'a' } : kind === 1 ? { correct_answer: i % 2 === 0 } : { blanks: [{ id: 'b1', accepted_answers: ['alpha', 'beta'] }] },
        explanation: `Because reason ${i}.`, reference: null, topicIds: [topics[s.id][i % 10]], tagIds: [tags[i % 6], tags[(i + 2) % 6]] }
    })
    const made = await time('save questions with topic and tag links', async () => (await qr.createMany(inputs)).data)
    const all = (await qr.list()).data
    const day = 86400000, now = Date.now()
    const changes = all.map((q, i) => ({ table: 'user_question_attempts', id: crypto.randomUUID(), create: { question_id: q.id, question_version: 1, response: {}, score: i % 3 ? 1 : 0, max_score: 1, outcome: i % 3 ? 'correct' : 'incorrect', confidence: i % 5 ? (i % 5) + 1 : null, time_ms: 4000 + (i % 9) * 1000, mode: 'practice', session_id: null, attempted_at: new Date(now - (i % 90) * day).toISOString() } }))
    await time('save saved answers', async () => { for (let i = 0; i < changes.length; i += 1000) await store.apply(changes.slice(i, i + 1000)) })
    return { made, T, answers: changes.length }
  }, { n: N, uid })
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s (real IndexedDB, unthrottled):`, JSON.stringify(result))
  await ctx.close()
  if (result.made.created !== N) { console.error('SEED FAILED'); process.exit(1) }
}

async function measure() {
  const { ctx, page, errs } = await open(4)
  const timed = async (name, path, ready, extra) => {
    const t0 = Date.now()
    await page.goto(`${BASE}${path}`)
    await ready(page).waitFor({ timeout: 120000 })
    rec(name, Date.now() - t0)
    if (extra) await extra()
  }
  await timed('Home (counts, due for revision)', '/app', (p) => p.getByText('due for revision'))
  await timed('My questions: whole bank opens', '/app/workspace/questions', (p) => p.getByRole('button', { name: /Show 50 more/ }), async () => {
    const t0 = Date.now()
    await page.getByLabel('Search questions').fill('valve')
    await page.getByText(/valve/).first().waitFor({ timeout: 60000 })
    await page.waitForFunction(() => !/Statement number \d+ about kidney/.test(document.querySelector('main')?.textContent || ''), null, { timeout: 60000 })
    rec('My questions: search "valve" (typed into the box)', Date.now() - t0)
    const t1 = Date.now()
    await page.getByRole('button', { name: /Show 50 more/ }).click()
    await page.waitForFunction(() => (document.querySelector('main')?.textContent.match(/Statement number/g) || []).length >= 100, null, { timeout: 60000 })
    rec('My questions: Show 50 more', Date.now() - t1)
  })
  await timed('Practice and exams: counts the bank', '/app/workspace/practice', (p) => p.getByText(/\d+ questions available/))
  {
    const t0 = Date.now()
    await page.getByLabel('Number of questions').fill('500')
    await page.getByRole('button', { name: 'Start practice' }).click()
    await page.getByText(/Question 1 of 500/).waitFor({ timeout: 120000 })
    rec('Start a 500-question session from 20,000', Date.now() - t0)
    const t1 = Date.now()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByText(/Question 2 of 500/).waitFor({ timeout: 30000 })
    rec('Next question', Date.now() - t1)
  }
  await timed('Revision and insights', '/app/workspace/revision', (p) => p.getByRole('heading', { name: 'Revision and insights', exact: true }), async () => { await page.getByText(/question(s)? due now|Nothing is due/).first().waitFor({ timeout: 120000 }) })
  await timed('Data health (storage, full data check)', '/app/workspace/health', (p) => p.getByText(/No problems found|problem(s)? found/))
  if (errs.length) { console.log('PAGE ERRORS:', errs.slice(0, 3).join(' | ')); process.exitCode = 1 }
  await ctx.close()
  const slow = out.filter(([, ms]) => ms > 15000)
  console.log(slow.length ? `\nSLOW (over 15 s at 4x slower CPU): ${slow.map((s) => s[0]).join('; ')}` : '\nAll timed screens under 15 s with a 4x slower CPU.')
}
;(mode === 'seed' ? seed() : measure()).catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(2) })
