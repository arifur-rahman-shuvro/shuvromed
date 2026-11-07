/*
 * One-off tool: renders public/icon.svg to the PNG icons the installed app needs.
 * Not part of the build. The PNGs are committed. Needs Playwright, which is not a project dependency:
 *   node scripts/make-icons.cjs
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8')
const out = path.join(__dirname, '..', 'public', 'icons')
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'maskable-512.png': 512, 'apple-touch-icon.png': 180 }

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  for (const [name, size] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
    await page.screenshot({ path: path.join(out, name), omitBackground: false })
    await page.close()
  }
  await browser.close()
  console.log('wrote', Object.keys(sizes).join(', '))
})()
