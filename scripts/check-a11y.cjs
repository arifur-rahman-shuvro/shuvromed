/*
 * Runs the axe accessibility engine in real Chromium over every screen, in light and dark mode, at phone width.
 *   node scripts/check-a11y.cjs <base-url>
 * Needs Playwright (not a project dependency) and a built site already being served. The build must use
 * VITE_SUPABASE_URL=https://example.supabase.co. A fake local session is used and supabase.co is blocked.
 * axe finds roughly a third of accessibility problems automatically. It does not replace a screen reader test.
 */
const { chromium } = require('playwright')
const axeSource = require('axe-core').source
const BASE = process.argv[2] || 'http://localhost:4190'
const uid = '11111111-1111-4111-8111-111111111111'
const failures = []
let checked = 0

async function audit(page, name) {
  await page.waitForTimeout(450) // let colour transitions finish so axe does not sample a half-way colour
  await page.evaluate(axeSource)
  const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }))
  checked++
  for (const v of res.violations) {
    failures.push({ name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 160)) })
  }
  console.log(`${res.violations.length === 0 ? 'PASS' : 'FAIL'}  ${name}  (${res.violations.length} issues, ${res.passes.length} rules passed)`)
}

;(async () => {
  const b = await chromium.launch()
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' })
    const now = Math.floor(Date.now() / 1000)
    const sess = { access_token: 'x.y.z', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'a11y@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
    await ctx.route('**/*.supabase.co/**', (r) => r.abort())
    await ctx.addInitScript(([s, u, sc]) => {
      try {
        localStorage.setItem('shuvromed.theme', sc)
        if (location.pathname.startsWith('/app')) localStorage.setItem('sb-example-auth-token', JSON.stringify(s))
        if (!localStorage.getItem('shuvromed.attempts.v1.' + u)) {
          const base = Date.now() - 86400000
          const mk = (q, ok, i) => ({ id: crypto.randomUUID(), questionId: q, selectedOptionId: 'A', isCorrect: ok, timeMs: 5000 + i * 100, mode: 'practice', attemptedAt: new Date(base + i * 60000).toISOString(), contentVersion: 'v', confidence: 'sure' })
          localStorage.setItem('shuvromed.attempts.v1.' + u, JSON.stringify(['demo-anat-cor-001', 'demo-anat-cor-002', 'demo-anat-cor-003', 'demo-phys-001', 'demo-pharm-001'].map((q, i) => mk(q, i % 2 === 0, i))))
        }
      } catch {}
    }, [sess, uid, scheme])
    const page = await ctx.newPage()
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)))
    const routes = [
      ['landing', '/', /create free account/i], ['login', '/login', 'Sign in'], ['signup', '/signup', null], ['forgot password', '/forgot-password', null],
      ['home', '/app', 'Home'], ['old dashboard', '/app/legacy', 'Dashboard'], ['my subjects', '/app/workspace/subjects', 'My subjects'], ['my questions', '/app/workspace/questions', 'My questions'], ['practice and exams', '/app/workspace/practice', 'Practice and exams'], ['past sessions', '/app/workspace/sessions', 'Past sessions'], ['revision and insights', '/app/workspace/revision', 'Revision and insights'], ['my tags', '/app/workspace/tags', 'My tags'], ['import and export', '/app/workspace/import', 'Import and export'], ['data health', '/app/workspace/health', 'Data health'], ['subjects', '/app/subjects', 'Subjects'], ['revision', '/app/revision', 'Revision'], ['bookmarks', '/app/bookmarks', 'Bookmarks'],
      ['notebook', '/app/notebook', 'Notebook'], ['practice setup', '/app/practice', 'Practice setup'], ['mock setup', '/app/mock', 'Mock exam'], ['progress', '/app/progress', 'Progress'],
      ['analytics', '/app/analytics', 'Analytics'], ['settings', '/app/settings', 'Settings'], ['not found', '/app/nope', null],
    ]
    for (const [name, path, wait] of routes) {
      await page.goto(BASE + path)
      if (wait instanceof RegExp) await page.getByRole('link', { name: wait }).first().waitFor({ timeout: 8000 })
      else if (wait) await page.getByRole('heading', { name: wait, exact: true }).first().waitFor({ timeout: 8000 })
      else await page.waitForTimeout(800)
      await page.waitForTimeout(250)
      await audit(page, `${scheme}: ${name}`)
    }
    // Practice player, before and after answering, and the end-session dialog
    await page.goto(BASE + '/app/practice'); await page.getByRole('button', { name: 'Start practice' }).click()
    await page.locator('input[name=answer]').first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: practice question`)
    await page.locator('input[name=answer]').first().check(); await page.getByRole('button', { name: 'Submit answer' }).click()
    await page.getByRole('region', { name: 'Answer explanation' }).waitFor()
    await audit(page, `${scheme}: practice answered + explanation`)
    await page.getByRole('button', { name: 'Finish session' }).click()
    await page.waitForTimeout(300)
    await audit(page, `${scheme}: practice finish step`)
    // Mock exam run
    await page.goto(BASE + '/app/mock'); await page.getByRole('button', { name: 'Start exam' }).click()
    await page.locator('input[name=answer]').first().waitFor({ timeout: 8000 }).catch(() => {})
    await audit(page, `${scheme}: mock exam running`)
    // Subject topics page
    await page.goto(BASE + '/app/subjects'); await page.getByRole('link', { name: /Anatomy/ }).first().click()
    await page.waitForTimeout(500)
    await audit(page, `${scheme}: subject topics`)
    // The private workspace WITH data: import real questions through the screen, then audit every state a learner meets.
    const PASTE = `Subject: Anatomy
Topic: Thorax > Heart
Tags: high yield
Difficulty: medium

Q: Which valve lies between the left atrium and the left ventricle?
A) Tricuspid
B) Mitral *
C) Aortic
D) Pulmonary
Explanation: The mitral valve is also called the bicuspid valve.
---
Q: The sinoatrial node is the natural pacemaker of the heart.
Answer: True
---
Subject: Physiology
Topic: Renal
Q: The [nephron|functional unit of the kidney] filters blood.
---
Q: Which hormone raises blood calcium?
A) Calcitonin
B) Parathyroid hormone *
C) Insulin
`
    await page.goto(BASE + '/app/workspace/import')
    await page.getByLabel('Paste questions here').fill(PASTE)
    await page.getByRole('button', { name: 'Check' }).click()
    await page.getByRole('region', { name: 'Import report' }).waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: import report`)
    await page.getByRole('button', { name: /^Import \d+ question/ }).click()
    await page.getByText(/Imported|imported/).first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: import done`)
    await page.goto(BASE + '/app'); await page.getByText('due for revision').waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: home with data`)
    await page.goto(BASE + '/app/workspace/questions'); await page.getByText(/valve/).first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: my questions list`)
    await page.getByRole('link', { name: /Which valve/ }).first().click().catch(() => {})
    await page.waitForTimeout(500)
    await audit(page, `${scheme}: question after click`)
    await page.goto(BASE + '/app/workspace/questions/new'); await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: question editor`)
    await page.goto(BASE + '/app/workspace/practice'); await page.getByText(/\d+ questions? available/).waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: practice setup with data`)
    await page.getByRole('button', { name: 'Start practice' }).click()
    await page.getByText(/Question 1 of/).waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: practice player`)
    await page.locator('input[type=radio], input[type=checkbox]').first().check().catch(() => {})
    await page.getByRole('button', { name: 'Certain' }).click().catch(() => {})
    await page.getByRole('button', { name: 'Check answer' }).click().catch(() => {})
    await page.waitForTimeout(400)
    await audit(page, `${scheme}: practice answered, feedback and confidence`)
    await page.getByRole('button', { name: 'Finish' }).click()
    await page.getByLabel('Score').waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: session result`)
    await page.getByRole('button', { name: /Question 1/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await audit(page, `${scheme}: result review open`)
    await page.goto(BASE + '/app/workspace/practice'); await page.getByText(/\d+ questions? available/).waitFor({ timeout: 8000 })
    await page.getByRole('radio', { name: /^Exam/ }).check()
    await page.getByRole('button', { name: 'Start exam' }).click()
    await page.getByText(/Question 1 of/).waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: exam player with palette`)
    await page.getByRole('button', { name: 'Submit exam' }).click()
    await page.getByRole('group', { name: 'Confirm submit' }).waitFor({ timeout: 5000 })
    await audit(page, `${scheme}: exam submit confirmation`)
    await page.getByRole('button', { name: 'Yes, submit' }).click()
    await page.getByLabel('Score').waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: exam result`)
    await page.goto(BASE + '/app/workspace/sessions'); await page.getByText(/Review/).first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: past sessions with data`)
    await page.goto(BASE + '/app/workspace/revision'); await page.getByRole('heading', { name: 'Revision and insights', level: 1 }).waitFor({ timeout: 8000 })
    await page.waitForTimeout(500)
    await audit(page, `${scheme}: revision and insights with data`)
    await page.goto(BASE + '/app/workspace/tags'); await page.getByRole('heading', { name: 'My tags', level: 1 }).waitFor({ timeout: 8000 }); await page.waitForTimeout(500)
    await audit(page, `${scheme}: tags with data`)
    await page.goto(BASE + '/app/workspace/health'); await page.getByText(/No problems found|problem/).first().waitFor({ timeout: 8000 })
    await audit(page, `${scheme}: data health with data`)
    if (errs.length) failures.push({ name: `${scheme}: page errors`, id: 'js-error', impact: 'n/a', help: errs.join(' | ').slice(0, 200), nodes: [] })
    await ctx.close()
  }
  await b.close()
  console.log(`\n${checked} screens audited, ${failures.length} issue groups`)
  const byId = {}
  for (const f of failures) (byId[f.id + ' | ' + f.help] ??= []).push(f)
  for (const [k, list] of Object.entries(byId)) {
    console.log(`\n${k}  [${list[0].impact}]  on ${list.length} screens`)
    for (const f of list.slice(0, 4)) console.log(`   - ${f.name}`, ...f.nodes.map((n) => '\n       ' + n))
  }
  process.exit(failures.length ? 1 : 0)
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(2) })
