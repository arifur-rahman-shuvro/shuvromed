/**
 * Validates ./content and writes the static files the app downloads to public/content/.
 * Refuses to build if validation fails. Set CONTENT_INCLUDE_DEMO=0 to exclude DEMO questions.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildBundle } from '../src/content/bundle'
import { formatIssue, validateContent } from '../src/content/validate'
import { loadContentDir } from './content-fs'

const root = resolve('content')
const out = resolve('public/content')
const includeDemo = process.env.CONTENT_INCLUDE_DEMO !== '0'

const { input, fileIssues } = loadContentDir(root)
const report = validateContent(input)
const errors = [...fileIssues.filter((i) => i.severity === 'error'), ...report.errors]
if (errors.length > 0) {
  for (const e of errors) console.error(formatIssue(e))
  console.error(`\ncontent build FAILED: ${errors.length} error(s). Nothing was written.`)
  process.exit(1)
}

const bundle = buildBundle(report.content, { includeDemo }, (s) => createHash('sha256').update(s).digest('hex'))

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'questions'), { recursive: true })
writeFileSync(join(out, 'taxonomy.json'), JSON.stringify(bundle.taxonomy))
for (const [subjectId, list] of Object.entries(bundle.questionFiles)) {
  writeFileSync(join(out, 'questions', `${subjectId}.json`), JSON.stringify(list))
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(bundle.manifest))

console.log(
  `content built: ${bundle.manifest.totalQuestions} question(s) in ${bundle.manifest.subjects.length} subject file(s), ` +
    `version ${bundle.manifest.contentVersion}, demo ${includeDemo ? 'INCLUDED' : 'excluded'} -> ${out}`,
)
