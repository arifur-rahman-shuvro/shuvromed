import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import SyncStatus from './SyncStatus'
import { SyncProvider } from '../sync/SyncContext'
import { useLegacyVisible, useWorkspaceEnabled } from '../workspace/flag'
import WorkspaceProvider from '../workspace/WorkspaceProvider'
import { THEME_EVENT, applyTheme, getThemePref, resolveDark } from '../lib/theme'

export const NAV = [
  { to: '/app', label: 'Dashboard', end: true, glyph: '⌂' },
  { to: '/app/subjects', label: 'Subjects', end: false, glyph: '▤' },
  { to: '/app/revision', label: 'Revision', end: false, glyph: '↻' },
  { to: '/app/bookmarks', label: 'Bookmarks', end: false, glyph: '☆' },
  { to: '/app/notebook', label: 'Notebook', end: false, glyph: '▧' },
  { to: '/app/mock', label: 'Mock exam', end: false, glyph: '◷' },
  { to: '/app/progress', label: 'Progress', end: false, glyph: '⌁' },
  { to: '/app/analytics', label: 'Analytics', end: false, glyph: '▥' },
  { to: '/app/settings', label: 'Settings', end: false, glyph: '⚙' },
]

const WORKSPACE_MENU = [
  { to: '/app', label: 'Home', end: true, glyph: '⌂' },
  { to: '/app/workspace/subjects', label: 'My subjects', end: false, glyph: '▤' },
  { to: '/app/workspace/questions', label: 'My questions', end: false, glyph: '▦' },
  { to: '/app/workspace/practice', label: 'Practice and exams', end: false, glyph: '▶' },
  { to: '/app/workspace/revision', label: 'Revision and insights', end: false, glyph: '↻' },
  { to: '/app/workspace/tags', label: 'My tags', end: false, glyph: '#' },
  { to: '/app/workspace/import', label: 'Import / export', end: false, glyph: '⇅' },
  { to: '/app/workspace/health', label: 'Data health', end: false, glyph: '◉' },
]
const WORKSPACE_TABS = [
  { to: '/app', label: 'Home', end: true, glyph: '⌂' },
  { to: '/app/workspace/questions', label: 'Questions', end: false, glyph: '▦' },
  { to: '/app/workspace/practice', label: 'Practice', end: false, glyph: '▶' },
  { to: '/app/workspace/revision', label: 'Insights', end: false, glyph: '↻' },
  { to: '/app/settings', label: 'Settings', end: false, glyph: '⚙' },
]
const SETTINGS = { to: '/app/settings', label: 'Settings', end: false, glyph: '⚙' }
const OLD_SCREENS = [
  { to: '/app/legacy', label: 'Old dashboard', end: true, glyph: '⌂' },
  ...NAV.filter((n) => ['Subjects', 'Revision', 'Bookmarks', 'Notebook', 'Mock exam', 'Progress', 'Analytics'].includes(n.label)).map((n) => ({ ...n, label: `Old ${n.label.toLowerCase()}` })),
]
/** The side menu: the private workspace by default; the old demo screens only when asked for (their data is kept either way). */
export function menuFor(workspaceOn: boolean, legacyOn: boolean) {
  if (!workspaceOn) return NAV
  return [...WORKSPACE_MENU, ...(legacyOn ? OLD_SCREENS : []), SETTINGS]
}

type MenuItem = { to: string; label: string; end: boolean; glyph: string }
const COMMANDS = [
  { label: 'Go to Home', description: 'Your learning overview', to: '/app', keywords: 'dashboard home' },
  { label: 'Open question bank', description: 'Search, filter and edit questions', to: '/app/workspace/questions', keywords: 'questions bank search' },
  { label: 'Create a question', description: 'Write a new question', to: '/app/workspace/questions/new', keywords: 'new add editor' },
  { label: 'Start practice', description: 'Build a focused practice session', to: '/app/workspace/practice', keywords: 'practice quiz exam' },
  { label: 'Open revision', description: 'Review due and weak questions', to: '/app/workspace/revision', keywords: 'revision due review' },
  { label: 'Manage subjects', description: 'Organise subjects and topics', to: '/app/workspace/subjects', keywords: 'subjects topics' },
  { label: 'Open settings', description: 'Preferences and account controls', to: '/app/settings', keywords: 'settings preferences theme' },
]

function Shell() {
  const [dark, setDark] = useState(() => resolveDark(getThemePref()))
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const paletteRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const follow = () => setDark(resolveDark(getThemePref()))
    window.addEventListener(THEME_EVENT, follow)
    return () => window.removeEventListener(THEME_EVENT, follow)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      window.requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [paletteOpen])

  const { user, signOut } = useAuth()
  const workspaceOn = useWorkspaceEnabled(user?.id)
  const legacyOn = useLegacyVisible(user?.id)
  const sideNav = menuFor(workspaceOn, legacyOn) as MenuItem[]
  const tabNav = workspaceOn ? WORKSPACE_TABS : NAV.filter((n) => !['Mock exam', 'Bookmarks', 'Notebook', 'Progress'].includes(n.label))
  const navigate = useNavigate()
  const commandItems = workspaceOn ? COMMANDS : NAV.map((item) => ({
    label: `Open ${item.label}`,
    description: `Go to ${item.label}`,
    to: item.to,
    keywords: item.label,
  }))
  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return commandItems.filter((item) => !needle || `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(needle))
  }, [commandItems, query])

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    applyTheme(next)
    setDark(!dark)
  }

  function runCommand(path: string) {
    setPaletteOpen(false)
    navigate(path)
  }

  return (
    <div className={`min-h-dvh bg-bg text-ink md:grid ${collapsed ? 'md:grid-cols-[5rem_minmax(0,1fr)]' : 'md:grid-cols-[16rem_minmax(0,1fr)]'}`}>
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          const main = document.getElementById('main')
          main?.setAttribute('tabindex', '-1')
          main?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:font-semibold focus:text-brandfg"
      >
        Skip to main content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-5 md:flex" aria-label="Sidebar">
        <div className={`mb-7 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-lg font-bold text-brandfg" aria-hidden="true">S</span>
            {!collapsed ? <div className="min-w-0"><p className="truncate text-[15px] font-bold tracking-tight">ShuvroMed</p><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted">Clinical learning</p></div> : null}
          </div>
          {!collapsed ? <button type="button" onClick={() => setCollapsed(true)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink" aria-label="Collapse sidebar" title="Collapse sidebar">«</button> : null}
        </div>

        {collapsed ? <button type="button" onClick={() => setCollapsed(false)} className="mb-4 grid min-h-10 place-items-center rounded-lg text-muted hover:bg-surface2" aria-label="Expand sidebar" title="Expand sidebar">»</button> : null}

        <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-muted ${collapsed ? 'sr-only' : ''}`}>Workspace</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {sideNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={({ isActive }) => `group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors focus-visible:outline-offset-2 ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-brand/10 text-brand dark:bg-brand/15' : 'text-muted hover:bg-surface2 hover:text-ink'}`}
            >
              <span className="grid size-7 shrink-0 place-items-center text-lg leading-none" aria-hidden="true">{item.glyph}</span>
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
              {item.to === '/app/workspace/questions' && !collapsed ? <span className="ml-auto rounded-md bg-surface2 px-1.5 py-0.5 text-[10px] text-muted">Bank</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-line pt-4">
          <button type="button" onClick={() => setPaletteOpen(true)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs text-muted hover:bg-surface2 hover:text-ink ${collapsed ? 'justify-center' : ''}`} title="Open command menu">
            <span className="grid size-7 place-items-center text-base" aria-hidden="true">⌘</span>
            {!collapsed ? <><span>Quick actions</span><kbd className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px]">Ctrl K</kbd></> : null}
          </button>
          {!collapsed ? <p className="mt-3 px-3 text-[10px] text-muted">A focused space for better clinical thinking.</p> : null}
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-line/80 bg-surface/95 px-4 backdrop-blur-sm md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-brandfg md:hidden" aria-hidden="true">S</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold md:text-[13px]">{user?.email ?? 'Educational use only'}</p>
              <div className="text-[11px] text-muted"><SyncStatus /></div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => setPaletteOpen(true)} className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-bg px-3 text-xs text-muted transition-colors hover:border-brand/50 hover:text-ink" aria-label="Search commands">
              <span aria-hidden="true">⌕</span><span className="hidden sm:inline">Search or jump to…</span><kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] sm:inline">⌘ K</kbd>
            </button>
            <button type="button" onClick={toggleTheme} aria-pressed={dark} className="grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-surface2 hover:text-ink" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
              <span aria-hidden="true">{dark ? '☼' : '☾'}</span>
            </button>
            <button type="button" onClick={handleSignOut} className="min-h-10 rounded-xl px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface2 hover:text-ink sm:px-3">Sign out</button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[88rem] flex-1 px-4 py-6 outline-none sm:px-6 md:px-8 md:py-8">
          {workspaceOn ? <WorkspaceProvider><Outlet /></WorkspaceProvider> : <Outlet />}
        </main>
      </div>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,.06)] backdrop-blur md:hidden">
        {tabNav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-1 text-[10px] font-medium transition-colors ${isActive ? 'text-brand' : 'text-muted'}`}>
            <span className="text-base leading-5" aria-hidden="true">{item.glyph}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {paletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-3 pt-[12vh] backdrop-blur-[2px] sm:px-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false) }}>
          <div ref={paletteRef} role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onKeyDown={(event) => {
            if (event.key === 'Tab') {
              const controls = paletteRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')
              if (!controls?.length) return
              const first = controls[0]
              const last = controls[controls.length - 1]
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
            }
          }}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <span className="text-lg text-muted" aria-hidden="true">⌕</span>
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions…" className="min-h-14 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted" aria-label="Search commands" />
              <kbd className="rounded border border-line px-1.5 py-1 text-[10px] text-muted">ESC</kbd>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted">Suggestions</p>
              {filteredCommands.length ? filteredCommands.map((item) => (
                <button key={item.to} type="button" onClick={() => runCommand(item.to)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 text-left transition-colors hover:bg-surface2 focus-visible:bg-surface2">
                  <span><span className="block text-sm font-medium text-ink">{item.label}</span><span className="mt-0.5 block text-xs text-muted">{item.description}</span></span>
                  <span className="text-muted" aria-hidden="true">↵</span>
                </button>
              )) : <p className="px-3 py-8 text-center text-sm text-muted">No matching commands.</p>}
            </div>
            <div className="flex items-center justify-between border-t border-line bg-bg px-4 py-2.5 text-[10px] text-muted"><span>Navigate your learning workspace</span><span>Ctrl / ⌘ K to toggle</span></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function AppLayout() {
  return (
    <SyncProvider>
      <Shell />
    </SyncProvider>
  )
}
