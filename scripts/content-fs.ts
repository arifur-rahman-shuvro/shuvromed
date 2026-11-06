import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ContentInput, Issue, Sourced } from '../src/content/validate'

/** All *.json files below dir, recursively, in a stable order. */
function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsonFiles(full))
    else if (name.endsWith('.json')) out.push(full)
  }
  return out
}

/**
 * Reads the content/ folder into the validator's input shape. Problems with the files
 * themselves (bad JSON, not an array) are returned as issues instead of throwing.
 */
export function loadContentDir(root: string): { input: ContentInput; fileIssues: Issue[] } {
  const fileIssues: Issue[] = []

  function readArray(file: string): Sourced[] {
    const label = relative(process.cwd(), file) || file
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      fileIssues.push({ severity: 'error', code: 'json-parse', source: label, message: `invalid JSON: ${(e as Error).message}` })
      return []
    }
    if (!Array.isArray(parsed)) {
      fileIssues.push({ severity: 'error', code: 'not-array', source: label, message: 'file must contain a JSON array' })
      return []
    }
    return parsed.map((data, i) => ({ source: `${label}[${i}]`, data }))
  }

  const single = (name: string): Sourced[] => {
    const file = join(root, name)
    if (!existsSync(file)) {
      fileIssues.push({ severity: 'error', code: 'missing-file', source: name, message: `required file ${name} is missing` })
      return []
    }
    return readArray(file)
  }

  const input: ContentInput = {
    subjects: single('subjects.json'),
    examStyles: single('exam-styles.json'),
    formats: single('question-formats.json'),
    topics: jsonFiles(join(root, 'topics')).flatMap(readArray),
    questions: jsonFiles(join(root, 'questions')).flatMap(readArray),
  }
  return { input, fileIssues }
}
