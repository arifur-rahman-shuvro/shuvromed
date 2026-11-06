/**
 * Bulk question import (CSV or JSON). Nothing is written unless the WHOLE content set validates.
 *   npm run content:import -- path/to/questions.csv
 *   npm run content:import -- path/to/questions.json --out content/questions/my-batch.json
 *   npm run content:import -- file.csv --dry-run      check only, write nothing
 *   npm run content:import -- file.csv --force        replace an existing output file
 * Imported questions are always written as draft + unreviewed. They are never published here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { runImport, type ImportFormat } from '../src/content/import'
import { formatIssue } from '../src/content/validate'
import { loadContentDir } from './content-fs'

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const valueOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
if (!file) {
  console.error('usage: npm run content:import -- <file.csv|file.json> [--out content/questions/name.json] [--dry-run] [--force]')
  process.exit(2)
}

const ext = extname(file).toLowerCase()
if (ext !== '.csv' && ext !== '.json') {
  console.error('the input must be a .csv or .json file')
  process.exit(2)
}
const format: ImportFormat = ext === '.csv' ? 'csv' : 'json'

const contentRoot = resolve('content')
const questionsDir = resolve(contentRoot, 'questions')
const out = resolve(valueOf('out') ?? `content/questions/imported-${basename(file, ext)}.json`)
if (!out.startsWith(questionsDir + sep) || extname(out) !== '.json') {
  console.error(`--out must be a .json file inside ${relative(process.cwd(), questionsDir)}/`)
  process.exit(2)
}
const outLabel = relative(process.cwd(), out)
if (existsSync(out) && !flag('force')) {
  console.error(`${outLabel} already exists. Use --force to replace it, or choose another --out.`)
  process.exit(2)
}

const { input, fileIssues } = loadContentDir(contentRoot)
// When replacing a file, its old questions must not count as duplicates of the new ones.
if (flag('force')) input.questions = input.questions.filter((q) => !q.source.startsWith(`${outLabel}[`))

const result = runImport({
  text: readFileSync(resolve(file), 'utf8'),
  format,
  label: relative(process.cwd(), resolve(file)),
  existing: input,
  now: new Date().toISOString(),
})

const issues = [...fileIssues, ...result.issues]
for (const i of issues) console.log(formatIssue(i))
const errors = issues.filter((i) => i.severity === 'error').length
const warnings = issues.length - errors

if (!result.ok || errors > 0) {
  console.log(`\nIMPORT FAILED: ${errors} error(s), ${warnings} warning(s). Nothing was written.`)
  process.exit(1)
}
if (flag('dry-run')) {
  console.log(`\nDRY RUN OK: ${result.questions.length} question(s) would be written to ${outLabel} as draft + unreviewed. Nothing was written.`)
  process.exit(0)
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(result.questions, null, 2) + '\n')
console.log(`\nIMPORTED ${result.questions.length} question(s) -> ${outLabel} (draft + unreviewed; ${warnings} warning(s)).`)
console.log('They are NOT visible to students until reviewed and published.')
