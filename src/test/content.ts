import { buildBundle, type Bundle } from '../content/bundle'
import { validateContent, type ContentInput, type Sourced, type ValidContent } from '../content/validate'

/** Loads the REAL files under /content, exactly as the CLI does, so tests exercise shipped data. */
const files = import.meta.glob('../../content/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

function records(prefix: string): Sourced[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(`../../content/${prefix}`))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, data]) => (data as unknown[]).map((d, i) => ({ source: `${path.replace('../../', '')}[${i}]`, data: d })))
}

export function realContentInput(): ContentInput {
  return {
    subjects: records('subjects.json'),
    examStyles: records('exam-styles.json'),
    formats: records('question-formats.json'),
    topics: records('topics/'),
    questions: records('questions/'),
  }
}

export function realContent(): ValidContent {
  const report = validateContent(realContentInput())
  if (!report.ok) throw new Error(`real content is invalid: ${report.errors.map((e) => e.message).join('; ')}`)
  return report.content
}

/** Rebuilds a validator input from (possibly mutated) content, labelling records by index. */
export function toInput(c: ValidContent): ContentInput {
  const label = (name: string, list: unknown[]): Sourced[] => list.map((data, i) => ({ source: `${name}[${i}]`, data }))
  return {
    subjects: label('subjects', c.subjects),
    topics: label('topics', c.topics),
    formats: label('formats', c.formats),
    examStyles: label('examStyles', c.examStyles),
    questions: label('questions', c.questions),
  }
}

/** Not cryptographic. Good enough to prove the content version reacts to changes. */
export function fakeHash(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + s.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2)
}

export function realBundle(opts: { includeDemo: boolean } = { includeDemo: true }): Bundle {
  return buildBundle(realContent(), opts, fakeHash)
}

/** Serves a built bundle through the same paths the browser requests, so the real loader code runs. */
export function bundleFetcher(bundle: Bundle, calls?: string[]): (path: string) => Promise<unknown> {
  return async (path) => {
    calls?.push(path)
    const clean = path.split('?')[0]
    if (clean === 'manifest.json') return structuredClone(bundle.manifest)
    if (clean === 'taxonomy.json') return structuredClone(bundle.taxonomy)
    const m = /^questions\/(.+)\.json$/.exec(clean)
    if (m && bundle.questionFiles[m[1]]) return structuredClone(bundle.questionFiles[m[1]])
    throw new Error(`Could not load ${path} (HTTP 404)`)
  }
}
