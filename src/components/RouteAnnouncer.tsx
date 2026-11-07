import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const SUFFIX = ' · ShuvroMed'

/**
 * In a single-page app the browser does not announce a new page, so a screen-reader user hears nothing when
 * they follow a link. After each navigation this sets the tab title from the page's h1 and moves focus to the
 * main area, which makes screen readers read the new page. It waits for lazily loaded pages to appear.
 * The first page load is left alone, because the browser already handles that.
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation()
  const first = useRef(true)

  useEffect(() => {
    const isFirst = first.current
    first.current = false

    const apply = () => {
      const main = document.querySelector('main')
      const h1 = main?.querySelector('h1') ?? document.querySelector('h1')
      const text = h1?.textContent?.trim()
      if (!text) return false
      document.title = text + SUFFIX
      if (!isFirst && main) {
        main.tabIndex = -1
        main.focus({ preventScroll: true })
      }
      return true
    }

    if (apply()) return
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const stop = setTimeout(() => observer.disconnect(), 5000)
    return () => {
      observer.disconnect()
      clearTimeout(stop)
    }
  }, [pathname])

  return null
}
