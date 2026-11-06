import { z } from 'zod'
import { ExamStyleSchema, QuestionFormatSchema, QuestionSchema, SubjectSchema, TopicSchema, type Question } from '../content/schema'
import type { Manifest, Taxonomy } from '../content/bundle'

/** Reads one JSON file under /content. Injected so tests can serve real built content without a network. */
export type Fetcher = (path: string) => Promise<unknown>

export const fetchFromSite: Fetcher = async (path) => {
  const res = await fetch(`/content/${path}`)
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`)
  return res.json()
}

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  contentVersion: z.string().min(1),
  includesDemo: z.boolean(),
  totalQuestions: z.number().int().min(0),
  subjects: z.array(z.object({ id: z.string(), questionCount: z.number().int().min(0), file: z.string() })),
})

const TaxonomySchema = z.object({
  subjects: z.array(SubjectSchema),
  topics: z.array(TopicSchema),
  formats: z.array(QuestionFormatSchema),
  examStyles: z.array(ExamStyleSchema),
})

export interface Catalog {
  manifest: Manifest
  taxonomy: Taxonomy
}

export interface ContentClient {
  loadCatalog(): Promise<Catalog>
  /** Questions for one subject. Fetched once, then served from memory. */
  loadSubjectQuestions(subjectId: string): Promise<Question[]>
}

/**
 * Everything downloaded is re-validated with the same Zod schemas the build used, so a corrupted
 * file or a stale cache entry produces a clear error instead of a broken page.
 */
export function createContentClient(fetcher: Fetcher): ContentClient {
  let catalog: Promise<Catalog> | null = null
  const subjects = new Map<string, Promise<Question[]>>()

  const once = <T>(store: { get(): Promise<T> | undefined; set(p: Promise<T>): void; clear(): void }, make: () => Promise<T>) => {
    const existing = store.get()
    if (existing) return existing
    const p = make().catch((e) => {
      store.clear() // allow a retry after a failure
      throw e
    })
    store.set(p)
    return p
  }

  return {
    loadCatalog() {
      return once(
        { get: () => catalog ?? undefined, set: (p) => (catalog = p), clear: () => (catalog = null) },
        async () => {
          const [m, t] = await Promise.all([fetcher('manifest.json'), fetcher('taxonomy.json')])
          return { manifest: ManifestSchema.parse(m) as Manifest, taxonomy: TaxonomySchema.parse(t) as Taxonomy }
        },
      )
    },
    async loadSubjectQuestions(subjectId) {
      const { manifest } = await this.loadCatalog()
      const entry = manifest.subjects.find((s) => s.id === subjectId)
      if (!entry) return [] // a subject with no published questions yet
      return once(
        { get: () => subjects.get(subjectId), set: (p) => subjects.set(subjectId, p), clear: () => subjects.delete(subjectId) },
        async () => {
          const raw = await fetcher(`${entry.file}?v=${manifest.contentVersion}`)
          return z.array(QuestionSchema).parse(raw)
        },
      )
    },
  }
}
