import { assetUrl } from '../lib/appUrl'
import { ManifestSchema } from '../data/loader'
import { QuestionSchema } from '../content/schema'
import { z } from 'zod'

/** Same names as the service worker's runtime caches (vite.config.ts), so it serves what is saved here. */
export const CATALOG_CACHE = 'shuvromed-catalog'
export const QUESTIONS_CACHE = 'shuvromed-questions'

export interface OfflineDeps {
  fetchFn?: typeof fetch
  caches?: CacheStorage
  base?: string
}

const urlFor = (file: string, base?: string) => assetUrl(`content/${file}`, base)

async function getJson(fetchFn: typeof fetch, url: string): Promise<{ json: unknown; res: Response }> {
  const res = await fetchFn(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const copy = res.clone()
  return { json: await res.json(), res: copy }
}

export interface OfflineResult {
  subjects: number
  files: number
}

/**
 * Saves the catalogue and every subject's question file into the device's cache so the whole bank works
 * offline. Everything is checked with the same schemas the app uses before it is kept, and nothing is saved
 * if any file is bad, so the cache never holds a half-set from different versions.
 */
export async function downloadAllForOffline(deps: OfflineDeps = {}): Promise<OfflineResult> {
  const fetchFn = deps.fetchFn ?? fetch.bind(globalThis)
  const store = deps.caches ?? caches
  const manifestUrl = urlFor('manifest.json', deps.base)
  const taxonomyUrl = urlFor('taxonomy.json', deps.base)

  const m = await getJson(fetchFn, manifestUrl)
  const manifest = ManifestSchema.parse(m.json)
  const t = await getJson(fetchFn, taxonomyUrl)

  const pending: { url: string; res: Response }[] = []
  for (const s of manifest.subjects) {
    const url = urlFor(`${s.file}?v=${manifest.contentVersion}`, deps.base)
    const q = await getJson(fetchFn, url)
    z.array(QuestionSchema).parse(q.json)
    pending.push({ url, res: q.res })
  }

  const catalog = await store.open(CATALOG_CACHE)
  await catalog.put(manifestUrl, m.res)
  await catalog.put(taxonomyUrl, t.res)
  const questions = await store.open(QUESTIONS_CACHE)
  for (const p of pending) await questions.put(p.url, p.res)
  return { subjects: manifest.subjects.length, files: pending.length + 2 }
}

export interface OfflineStatus {
  total: number
  saved: number
}

/** How many of the current version's subject files are already on this device. null when it cannot be told. */
export async function offlineStatus(deps: OfflineDeps = {}): Promise<OfflineStatus | null> {
  try {
    const store = deps.caches ?? caches
    const fetchFn = deps.fetchFn ?? fetch.bind(globalThis)
    let manifestJson: unknown
    try {
      manifestJson = (await getJson(fetchFn, urlFor('manifest.json', deps.base))).json
    } catch {
      const hit = await (await store.open(CATALOG_CACHE)).match(urlFor('manifest.json', deps.base))
      if (!hit) return null
      manifestJson = await hit.json()
    }
    const manifest = ManifestSchema.parse(manifestJson)
    const questions = await store.open(QUESTIONS_CACHE)
    let saved = 0
    for (const s of manifest.subjects) {
      if (await questions.match(urlFor(`${s.file}?v=${manifest.contentVersion}`, deps.base))) saved++
    }
    return { total: manifest.subjects.length, saved }
  } catch {
    return null
  }
}
