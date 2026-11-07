/*
 * Real-browser check of the installed-app behaviour against a built copy of the site.
 *   node scripts/check-offline.cjs <dist-dir-served-at> <base-url>
 * Needs Playwright (not a project dependency) and the site already being served, e.g. by `vite preview`.
 * The build must use VITE_SUPABASE_URL=https://example.supabase.co (the fake session is stored under that name).
 * It signs in with a fake local session and blocks supabase.co, so it tests the app shell, caching and
 * offline behaviour only. It does not test real sign-in.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const DIST = process.argv[2]
const BASE = (process.argv[3] || 'http://localhost:4190').replace(/\/$/, '')
const out = []
const rec = (n, ok, d = '') => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`) }
const ORIGIN = new URL(BASE).origin
const PREFIX = new URL(BASE).pathname.replace(/\/$/, '') // '' at the site root, '/shuvromed' for the preview
const uid = '11111111-1111-4111-8111-111111111111'

;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })
  const now = Math.floor(Date.now() / 1000)
  const sess = { access_token: 'x.y.z', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'offline@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
  await ctx.route('**/*.supabase.co/**', (r) => r.abort())
  await ctx.addInitScript((s) => { try { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)) } catch {} }, sess)
  const page = await ctx.newPage()
  const viol = []; const errs = []
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) viol.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errs.push(String(e)))

  // 1. Manifest + installability
  const man = await (await ctx.request.get(`${BASE.replace(/\/$/, '')}/manifest.webmanifest`)).json()
  rec('manifest has name, standalone display, start_url /app', man.name === 'ShuvroMed' && man.display === 'standalone' && man.start_url === PREFIX + '/app')
  let iconsOk = true
  for (const i of man.icons) { const r = await ctx.request.get(ORIGIN + i.src); iconsOk = iconsOk && r.ok() && (r.headers()['content-type'] || '').includes('image/png') }
  rec('every manifest icon loads as a PNG', iconsOk)
  rec('has a maskable icon', man.icons.some((i) => i.purpose === 'maskable'))

  // 2. First load installs the service worker
  await page.goto(`${BASE}/app`)
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).first().waitFor({ timeout: 10000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  rec('service worker registers and activates', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active))
  await page.getByText('ShuvroMed can now open without internet').waitFor({ timeout: 8000 }).then(() => rec('"ready for offline" notice appears once', true), () => rec('"ready for offline" notice appears once', false))
  await page.getByRole('button', { name: 'OK' }).click().catch(() => {})
  const cdp = await ctx.newCDPSession(page)
  const inst = await cdp.send('Page.getInstallabilityErrors')
  rec('Chromium reports no installability errors', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors))

  // 3. Save all questions
  await page.reload() // now controlled by the worker
  await page.goto(`${BASE}/app/settings`)
  await page.getByRole('heading', { name: 'Use without internet' }).waitFor()
  await page.getByText(/0 of 3 subjects are saved/).waitFor({ timeout: 8000 }).then(() => rec('Settings says 0 of 3 subjects saved at first', true), () => rec('Settings says 0 of 3 subjects saved at first', false))
  await page.getByRole('button', { name: 'Save all questions for offline' }).click()
  await page.getByText(/Saved 3 subjects on this device/).waitFor({ timeout: 8000 }).then(() => rec('"Save all questions" saves 3 subjects', true), () => rec('"Save all questions" saves 3 subjects', false))
  await page.getByText(/All 3 subjects are saved/).waitFor({ timeout: 8000 }).then(() => rec('Settings then says all 3 subjects are saved', true), () => rec('Settings then says all 3 subjects are saved', false))

  // 4. Offline: cold reload of deep routes, then practise and answer
  // The connection drops while the app is open: the header must say so at once.
  await ctx.setOffline(true)
  await page.locator('header').getByText(/Offline/).first().waitFor({ timeout: 8000 }).then(() => rec('connection drops while open: header shows Offline at once', true), async () => rec('connection drops while open: header shows Offline at once', false, (await page.locator('header').innerText()).replace(/\n+/g, ' | ')))
  for (const [p, h] of [['/app', 'Dashboard'], ['/app/subjects', 'Subjects'], ['/app/settings', 'Settings'], ['/app/analytics', 'Analytics']]) {
    await page.goto(`${BASE}${p}`)
    await page.getByRole('heading', { name: h, exact: true }).first().waitFor({ timeout: 10000 }).then(() => rec(`offline: ${p} opens`, true), () => rec(`offline: ${p} opens`, false))
  }
  await page.goto(`${BASE}/app/subjects`)
  await page.getByRole('link', { name: /Pharmacology/ }).click()
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  await page.goto(`${BASE}/app/practice`)
  await page.getByRole('heading', { name: 'Practice setup' }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Start practice' }).click()
  await page.locator('input[name=answer]').first().waitFor({ timeout: 8000 }).then(() => rec('offline: questions load from the device', true), () => rec('offline: questions load from the device', false))
  await page.locator('input[name=answer]').first().check()
  await page.getByRole('button', { name: 'Submit answer' }).click()
  await page.getByRole('region', { name: 'Answer explanation' }).waitFor({ timeout: 8000 }).then(() => rec('offline: an answer can be submitted and explained', true), () => rec('offline: an answer can be submitted and explained', false))
  const saved = await page.evaluate((u) => JSON.parse(localStorage.getItem('shuvromed.attempts.v1.' + u) || '[]').length, uid)
  rec('offline: the answer is saved on the device', saved >= 1, `${saved} attempts`)

  // 5. Back online: the app still works
  await ctx.setOffline(false)
  await page.goto(`${BASE}/app`)
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).first().waitFor({ timeout: 10000 }).then(() => rec('back online: app opens', true), () => rec('back online: app opens', false))

  // 6. Update flow: change the worker file, reload, expect the prompt, accept it
  fs.appendFileSync(path.join(DIST, 'sw.js'), '\n// test-update\n')
  await page.reload()
  await page.getByText('A new version of ShuvroMed is ready.').waitFor({ timeout: 15000 }).then(() => rec('update: prompt appears when a new version is waiting', true), () => rec('update: prompt appears when a new version is waiting', false))
  await page.getByRole('button', { name: 'Later' }).click()
  rec('update: "Later" dismisses it without reloading', (await page.getByText('A new version of ShuvroMed is ready.').count()) === 0)
  await page.reload()
  await page.getByText('A new version of ShuvroMed is ready.').waitFor({ timeout: 15000 })
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }).catch(() => {}), page.getByRole('button', { name: 'Reload now' }).click()])
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).first().waitFor({ timeout: 10000 })
  rec('update: "Reload now" installs it and the app opens', true)
  await page.waitForTimeout(500)
  rec('update: prompt is gone afterwards', (await page.getByText('A new version of ShuvroMed is ready.').count()) === 0)

  rec('no CSP violations', viol.length === 0, viol.join(' | '))
  rec('no JavaScript errors', errs.length === 0, errs.join(' | ').slice(0, 300))
  await b.close()
  console.log(`${out.filter(Boolean).length}/${out.length} passed`)
  process.exit(out.every(Boolean) ? 0 : 1)
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(2) })
