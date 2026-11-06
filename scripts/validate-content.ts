/**
 * CLI content validator. Used locally and in CI.
 *   npm run content:validate                 validates ./content
 *   npm run content:validate -- path/to/dir  validates another folder
 *   npm run content:validate -- --fail-on-warnings
 * Exit code 0 = valid, 1 = errors found.
 */
import { resolve } from 'node:path'
import { formatIssue, validateContent } from '../src/content/validate'
import { loadContentDir } from './content-fs'

const args = process.argv.slice(2)
const failOnWarnings = args.includes('--fail-on-warnings')
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'content')

const { input, fileIssues } = loadContentDir(dir)
const report = validateContent(input)
const errors = [...fileIssues.filter((i) => i.severity === 'error'), ...report.errors]
const warnings = report.warnings

for (const i of [...errors, ...warnings]) console.log(formatIssue(i))

const s = report.stats
console.log(
  `\n${dir}\n  subjects: ${s.subjects}  topics: ${s.topics}  questions: ${s.questions} ` +
    `(${Object.entries(s.questionsByStatus).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}; demo: ${s.demoQuestions})`,
)
console.log(`  errors: ${errors.length}  warnings: ${warnings.length}`)

if (errors.length > 0 || (failOnWarnings && warnings.length > 0)) {
  console.log('RESULT: FAILED')
  process.exit(1)
}
console.log('RESULT: OK')
