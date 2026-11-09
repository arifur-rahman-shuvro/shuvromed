import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import SyncStatus from './SyncStatus'
import { SyncProvider } from '../sync/SyncContext'
import { useLegacyVisible, useWorkspaceEnabled } from '../workspace/flag'
import WorkspaceProvider from '../workspace/WorkspaceProvider'
import { THEME_EVENT, applyTheme, getThemePref, resolveDark } from '../lib/theme'

export const NAV = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/subjects', label: 'Subjects', end: false },
  { to: '/app/revision', label: 'Revision', end: false },
  { to: '/app/bookmarks', label: 'Bookmarks', end: false },
  { to: '/app/notebook', label: 'Notebook', end: false },
  { to: '/app/mock', label: 'Mock exam', end: false },
  { to: '/app/progress', label: 'Progress', end: false },
  { to: '/app/analytics', label: 'Analytics', end: false },
  { to: '/app/settings', label: 'Settings', end: false },
]

const WORKSPACE_MENU = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/workspace/subjects', label: 'My subjects', end: false },
  { to: '/app/workspace/questions', label: 'My questions', end: false },
  { to: '/app/workspace/practice', label: 'Practice and exams', end: false },
  { to: '/app/workspace/revision', label: 'Revision and insights', end: false },
  { to: '/app/workspace/tags', label: 'My tags', end: false },
  { to: '/app/workspace/import', label: 'Import / export', end: false },
  { to: '/app/workspace/health', label: 'Data health', end: false },
]
const WORKSPACE_TABS = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/workspace/questions', label: 'Questions', end: false },
  { to: '/app/workspace/practice', label: 'Practice', end: false },
  { to: '/app/workspace/revision', label: 'Insights', end: false },
  { to: '/app/settings', label: 'Settings', end: false },
]
const SETTINGS = { to: '/app/settings', label: 'Settings', end: false }
const OLD_SCREENS = [
  { to: '/app/legacy', label: 'Old dashboard', end: true },
  ...NAV.filter((n) => ['Subjects', 'Revision', 'Bookmarks', 'Notebook', 'Mock exam', 'Progress', 'Analytics'].includes(n.label)).map((n) => ({ ...n, label: `Old ${n.label.toLowerCase()}` })),
]
/** The side menu: the private workspace by default; the old demo screens only when asked for (their data is kept either way). */
export function menuFor(workspaceOn: boolean, legacyOn: boolean) {
  if (!workspaceOn) return NAV
  return [...WORKSPACE_MENU, ...(legacyOn ? OLD_SCREENS : []), SETTINGS]
}

const link = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 items-center rounded-xl px-4 font-medium ${
    isActive ? 'bg-brand text-brandfg' : 'text-ink hover:bg-surface2'
  }`

const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-1 items-center justify-center px-1 text-center text-xs font-medium ${
    isActive ? 'text-brand' : 'text-muted'
  }`

function Shell() {
  const [dark, setDark] = useState(() => resolveDark(getThemePref()))
  useEffect(() => {
    const follow = () => setDark(resolveDark(getThemePref()))
    window.addEventListener(THEME_EVENT, follow)
    return () => window.removeEventListener(THEME_EVENT, follow)
  }, [])
  const { user, signOut } = useAuth()
  const workspaceOn = useWorkspaceEnabled(user?.id)
  const legacyOn = useLegacyVisible(user?.id)
  const sideNav = menuFor(workspaceOn, legacyOn)
  const tabNav = workspaceOn ? WORKSPACE_TABS : NAV.filter((n) => !['Mock exam', 'Bookmarks', 'Notebook', 'Progress'].includes(n.label))
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    applyTheme(next)
    setDark(!dark)
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          const m = document.getElementById('main')
          m?.setAttribute('tabindex', '-1')
          m?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-30 focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:font-semibold focus:text-brandfg"
      >
        Skip to main content
      </a>
      <aside className="hidden border-r border-line bg-surface p-4 md:block" aria-label="Sidebar">
        <p className="px-4 pb-4 text-xl font-bold">ShuvroMed</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {sideNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
          <div className="flex min-w-0 flex-col">
            <p className="font-bold md:hidden">ShuvroMed</p>
            <p className="hidden truncate text-sm text-muted md:block">
              {user?.email ?? 'Educational use only'}
            </p>
            <SyncStatus />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={dark}
              className="min-h-12 whitespace-nowrap rounded-xl px-3 font-medium hover:bg-surface2 md:px-4"
            >
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-12 whitespace-nowrap rounded-xl px-3 font-medium hover:bg-surface2 md:px-4"
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
          {workspaceOn ? <WorkspaceProvider><Outlet /></WorkspaceProvider> : <Outlet />}
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface md:hidden"
      >
        {tabNav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={tabLink}>
            {n.label}
          </NavLink>
        ))}
      </nav>
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
