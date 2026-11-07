export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'shuvromed.theme'
export const THEME_EVENT = 'shuvromed:theme'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function resolveDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true
  if (pref === 'light') return false
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.classList.toggle('dark', resolveDark(pref))
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(THEME_EVENT)) // lets other parts of the screen (the header button) follow
}
