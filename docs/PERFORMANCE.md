# Performance

## What was done
- Every page is loaded on demand (code splitting); the signed-in shell is loaded only after sign-in.
- Libraries are in their own cached files (`vendor-react`, `vendor-supabase`, `vendor-zod`), so an app update does not make a phone re-download them. App code itself is about 47 KB (15 KB compressed).
- Cache rules (`public/_headers`): hashed files cached for a year; `sw.js`, `index.html`, manifest and content always revalidated.
- After the first visit the service worker serves the whole app from the phone, so repeat opens do not wait for the network.
- Questions are separate small files per subject and are fetched only when needed.

## Measured (Lighthouse 12, mobile profile with simulated slow 4G and 4x slower CPU, headless Chromium, against a local emulation of Cloudflare Pages with Brotli compression)
| Page | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Transferred |
|---|---|---|---|---|---|---|---|---|---|
| Home | 97 | 100 | 100 | 100 | 2.0 s | 2.1 s | 40 ms | 0 | 153 KiB |
| Sign in | 96 | 100 | 100 | 63* | 2.1 s | 2.4 s | 50 ms | 0 | 153 KiB |

\* SEO 63 on the sign-in page is deliberate: `robots.txt` asks search engines not to index `/login`.

Without compression the same build scored 68, because 688 KiB took 5 s on the simulated connection. Cloudflare Pages compresses automatically; **this was emulated, not measured on Cloudflare**.

## Not measured / limits
- No real-phone or real-network measurement. Lighthouse numbers are simulated and vary between runs.
- Signed-in screens were not scored by Lighthouse (it cannot hold a session); they use the same bundles plus a 5-12 KB page chunk.
- The Supabase client (56 KB compressed) is loaded on the home page even though a visitor who is not signed in rarely needs it yet. Loading it only on demand would save about a third of the first download but would change how sign-in is wired, so it was left alone to avoid risking verified behaviour. It is the next thing to do if first-load time matters.
- 8 DEMO questions only: loading and rendering a bank of thousands has not been tested. Per-subject files and the cache-first rule are designed for it; a real import will show whether a subject file becomes too big (then split by topic).
