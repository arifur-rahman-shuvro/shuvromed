import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncStatus from '../components/SyncStatus'
import PwaPrompt from '../pwa/PwaPrompt'
import OfflineCard from '../pwa/OfflineCard'
import { CATALOG_CACHE, QUESTIONS_CACHE, downloadAllForOffline, offlineStatus } from '../pwa/offlineContent'
import { _setPwaState, getPwaState } from '../pwa/register'
import { bundleFetcher, realBundle } from './content'

/** A tiny in-memory CacheStorage. Keys are absolute URLs, as in a real browser. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const abs = (u: string | Request) => new URL(typeof u === 'string' ? u : u.url, 'http://localhost').href
  return {
    stores,
    storage: {
      async open(name: string) {
        if (!stores.has(name)) stores.set(name, new Map())
        const m = stores.get(name)!
        return {
          async put(req: string | Request, res: Response) { m.set(abs(req), res) },
          async match(req: string | Request) { return m.get(abs(req))?.clone() },
          async keys() { return [...m.keys()].map((u) => new Request(u)) },
        }
      },
    } as unknown as CacheStorage,
  }
}

/** A fetch that serves the REAL built content, with no network. `mutate` can corrupt one file. */
function fakeFetch(opts: { base?: string; mutate?: (path: string, json: unknown) => unknown; failPath?: string } = {}) {
  const base = opts.base ?? '/'
  const fetcher = bundleFetcher(realBundle())
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url.pathname + url.search)
    const path = url.pathname.slice(`${base}content/`.length)
    if (opts.failPath === path) return new Response('nope', { status: 500 })
    let json = await fetcher(path + url.search)
    if (opts.mutate) json = opts.mutate(path, json)
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fn, calls }
}

describe('downloadAllForOffline', () => {
  it('saves the catalogue and every subject file under the exact URLs the app requests', async () => {
    const { storage, stores } = fakeCaches()
    const { fn } = fakeFetch()
    const r = await downloadAllForOffline({ fetchFn: fn, caches: storage, base: '/' })
    expect(r).toEqual({ subjects: 3, files: 5 })
    expect([...stores.get(CATALOG_CACHE)!.keys()].sort()).toEqual(['http://localhost/content/manifest.json', 'http://localhost/content/taxonomy.json'])
    const q = [...stores.get(QUESTIONS_CACHE)!.keys()].sort()
    expect(q).toHaveLength(3)
    for (const k of q) expect(k).toMatch(/^http:\/\/localhost\/content\/questions\/[a-z]+\.json\?v=[0-9a-f]{16}$/)
  })

  it('works under the GitHub Pages sub-path too', async () => {
    const { storage, stores } = fakeCaches()
    const { fn } = fakeFetch({ base: '/shuvromed/' })
    await downloadAllForOffline({ fetchFn: fn, caches: storage, base: '/shuvromed/' })
    expect([...stores.get(QUESTIONS_CACHE)!.keys()][0]).toContain('/shuvromed/content/questions/')
  })

  it('saves nothing at all if one file is corrupt, so versions are never mixed', async () => {
    const { storage, stores } = fakeCaches()
    const { fn } = fakeFetch({ mutate: (p, j) => (p.startsWith('questions/pharmacology') ? [{ id: 'broken' }] : j) })
    await expect(downloadAllForOffline({ fetchFn: fn, caches: storage, base: '/' })).rejects.toThrow()
    expect(stores.size).toBe(0)
  })

  it('saves nothing if a file cannot be fetched', async () => {
    const { storage, stores } = fakeCaches()
    const { fn } = fakeFetch({ failPath: 'taxonomy.json' })
    await expect(downloadAllForOffline({ fetchFn: fn, caches: storage, base: '/' })).rejects.toThrow(/HTTP 500/)
    expect(stores.size).toBe(0)
  })
})

describe('offlineStatus', () => {
  it('counts saved subjects for the current content version', async () => {
    const { storage } = fakeCaches()
    const { fn } = fakeFetch()
    expect(await offlineStatus({ fetchFn: fn, caches: storage, base: '/' })).toEqual({ total: 3, saved: 0 })
    await downloadAllForOffline({ fetchFn: fn, caches: storage, base: '/' })
    expect(await offlineStatus({ fetchFn: fn, caches: storage, base: '/' })).toEqual({ total: 3, saved: 3 })
  })

  it('works offline from the saved catalogue', async () => {
    const { storage } = fakeCaches()
    const online = fakeFetch()
    await downloadAllForOffline({ fetchFn: online.fn, caches: storage, base: '/' })
    const down = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    expect(await offlineStatus({ fetchFn: down, caches: storage, base: '/' })).toEqual({ total: 3, saved: 3 })
  })

  it('returns null when nothing is known', async () => {
    const { storage } = fakeCaches()
    const down = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    expect(await offlineStatus({ fetchFn: down, caches: storage, base: '/' })).toBeNull()
  })

  it('a new content version means the old files no longer count as saved', async () => {
    const { storage } = fakeCaches()
    const v1 = fakeFetch()
    await downloadAllForOffline({ fetchFn: v1.fn, caches: storage, base: '/' })
    const v2 = fakeFetch({ mutate: (p, j) => (p === 'manifest.json' ? { ...(j as object), contentVersion: 'ffffffffffffffff' } : j) })
    expect(await offlineStatus({ fetchFn: v2.fn, caches: storage, base: '/' })).toEqual({ total: 3, saved: 0 })
  })
})

describe('PwaPrompt', () => {
  afterEach(() => act(() => _setPwaState({ needRefresh: false, offlineReady: false })))

  it('shows nothing normally', () => {
    render(<PwaPrompt />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('announces an update, warns about sessions, and can be put off', async () => {
    render(<PwaPrompt />)
    act(() => _setPwaState({ needRefresh: true }))
    expect(await screen.findByText('A new version of ShuvroMed is ready.')).toBeInTheDocument()
    expect(screen.getByText(/ends a practice session/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(getPwaState().needRefresh).toBe(false)
    expect(screen.queryByText('A new version of ShuvroMed is ready.')).toBeNull()
  })

  it('says the app can work offline, then goes away', async () => {
    render(<PwaPrompt />)
    act(() => _setPwaState({ offlineReady: true }))
    expect(await screen.findByText(/can now open without internet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('OfflineCard', () => {
  beforeEach(() => {
    const { storage } = fakeCaches()
    vi.stubGlobal('caches', storage)
    vi.stubGlobal('fetch', fakeFetch().fn)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows how much is saved and saves everything on request', async () => {
    render(<OfflineCard />)
    expect(await screen.findByText(/0 of 3 subjects are saved/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save all questions for offline' }))
    expect(await screen.findByText(/Saved 3 subjects on this device/)).toBeInTheDocument()
    expect(await screen.findByText(/All 3 subjects are saved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
  })

  it('explains plainly when saving fails offline and changes nothing', async () => {
    render(<OfflineCard />)
    await screen.findByText(/0 of 3/)
    vi.stubGlobal('fetch', (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await userEvent.click(screen.getByRole('button', { name: 'Save all questions for offline' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You are offline. Connect to the internet and try again.')
    vi.restoreAllMocks()
  })

  it('is hidden where the browser has no cache storage', () => {
    vi.stubGlobal('caches', undefined)
    const { container } = render(<OfflineCard />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SyncStatus when the connection drops', () => {
  it('shows Offline immediately, and recovers when the connection returns', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<SyncStatus />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved on this device only')
    spy.mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Offline · answers are saved on this device/))
    spy.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device only'))
    spy.mockRestore()
  })
})
