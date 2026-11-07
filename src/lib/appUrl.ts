/**
 * The app can be served from the site root (Cloudflare Pages, local dev) or from a sub-path
 * (a GitHub Pages preview at /shuvromed/). Vite exposes the chosen base as BASE_URL, always with a
 * trailing slash. Everything that builds a URL goes through here so the two cases behave the same.
 */

const trimEnd = (s: string) => s.replace(/\/+$/, '')

/** Base path without a trailing slash: '' for the site root, '/shuvromed' for a sub-path. */
export function basePath(base: string = import.meta.env.BASE_URL): string {
  return trimEnd(base)
}

/** React Router basename: '/' for the root, otherwise the sub-path without a trailing slash. */
export function routerBasename(base: string = import.meta.env.BASE_URL): string {
  return basePath(base) || '/'
}

/** Absolute URL of an app route, e.g. appUrl('/login') -> https://host/shuvromed/login */
export function appUrl(
  route: string,
  origin: string = window.location.origin,
  base: string = import.meta.env.BASE_URL,
): string {
  const path = route.startsWith('/') ? route : `/${route}`
  return `${trimEnd(origin)}${basePath(base)}${path}`
}

/** URL of a static file shipped with the site (such as /content/manifest.json), relative to the base. */
export function assetUrl(file: string, base: string = import.meta.env.BASE_URL): string {
  return `${basePath(base)}/${file.replace(/^\/+/, '')}`
}
