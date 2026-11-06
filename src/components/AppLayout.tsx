import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { applyTheme, getThemePref, resolveDark } from '../lib/theme'

export const NAV = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/subjects', label: 'Subjects', end: false },
  { to: '/app/revision', label: 'Revision', end: false },
  { to: '/app/mock', label: 'Mock exam', end: false },
  { to: '/app/analytics', label: 'Analytics', end: false },
  { to: '/app/settings', label: 'Settings', end: false },
]

const link = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-12 items-center rounded-xl px-4 font-medium ${
    isActive ? 'bg-brand text-brandfg' : 'text-ink hover:bg-surface2'
  }`

const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-1 items-center justify-center px-1 text-center text-xs font-medium ${
    isActive ? 'text-brand' : 'text-muted'
  }`

export default function AppLayout() {
  const [dark, setDark] = useState(() => resolveDark(getThemePref()))

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    applyTheme(next)
    setDark(!dark)
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-line bg-surface p-4 md:block" aria-label="Sidebar">
        <p className="px-4 pb-4 text-xl font-bold">ShuvroMed</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
          <p className="font-bold md:hidden">ShuvroMed</p>
          <p className="hidden text-sm text-muted md:block">Educational use only</p>
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={dark}
            className="min-h-12 rounded-xl px-4 font-medium hover:bg-surface2"
          >
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface md:hidden"
      >
        {NAV.filter((n) => n.label !== 'Mock exam').map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={tabLink}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
