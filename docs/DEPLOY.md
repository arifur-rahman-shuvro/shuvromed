# Deploying to Cloudflare Pages (free)

Cloudflare Pages builds the site from GitHub every time `main` changes. Nothing here costs money and **no card is needed**.
Cloudflare Free limits (checked 2026-11-06, see docs/FREE_TIER.md): 500 builds per month, 25 MiB per file, 20,000 files.
Only the two PUBLIC values below go into Cloudflare. Never put a Supabase secret key, the database password or the backup passphrase there.

> Honest status: the build, the headers file, the service worker and the install/offline behaviour were tested here against an
> emulation of Cloudflare Pages. Cloudflare itself could not be reached from the build environment, so **the first real deploy is the real test**.
> Cloudflare's screens change; if a button is not where these steps say, send me what you see.

## Owner steps (Android Chrome)
1. Open https://dash.cloudflare.com/sign-up and create a free account with your email. Confirm the email. (Why: Pages hosting lives in a Cloudflare account.)
2. Open https://dash.cloudflare.com → left menu **Workers & Pages** → **Create application** → the **Pages** tab → **Import an existing Git repository** → **Get started**.
3. **Connect GitHub**, sign in, and when GitHub asks, allow Cloudflare access to **only the `shuvromed` repository** ("Only select repositories"). (Why: so Cloudflare can read the code and build it.)
4. Choose the repository `arifur-rahman-shuvro/shuvromed` → **Begin setup**.
5. Fill the form exactly:
   - Project name: `shuvromed` (your address will be `https://shuvromed.pages.dev`, or with a short suffix if the name is taken: note the real address).
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: leave empty.
6. Open **Environment variables (advanced)** and add two **Production** variables (type "Text"):
   - `VITE_SUPABASE_URL` = `https://jnpqrwutxwjoyoxntfbt.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your publishable key (it starts with `sb_publishable_`). It is public by design. If it starts with `sb_secret_` STOP: that is a secret key and must never go here.
7. Tap **Save and Deploy**. The first build takes a few minutes. When it says success, tap the address it shows.
8. Tell me the exact address. I will use it for the next step and the docs. (Do not change anything else yet.)

### Then tell Supabase where the site lives (needed for email links)
9. Open https://supabase.com/dashboard → project **shuvromed** → **Authentication** → **URL Configuration**.
10. **Site URL**: your Cloudflare address, e.g. `https://shuvromed.pages.dev` → **Save**.
11. **Redirect URLs** → **Add URL**, one at a time, then **Save**: `https://shuvromed.pages.dev`, `https://shuvromed.pages.dev/login`, `https://shuvromed.pages.dev/reset-password` (use your real address). Keep the GitHub preview address there too while you still test with it.
    (Why: without this, the link in the confirmation or reset-password email would not return to the app.)

### Check it on your phone
12. Open the Cloudflare address in Chrome. Sign up or sign in. Confirm that the email link opens the Cloudflare site, not the preview.
13. Chrome menu (three dots) → **Install app** (or **Add to Home screen**). Open ShuvroMed from the home screen: it opens full screen without the address bar.
14. In the app: **Settings → Use without internet → Save all questions for offline**. Then turn on airplane mode, close and reopen the app, and practise a question. Your answer is kept; the header says Offline. Turn airplane mode off: it says it is syncing.
15. Report pass/fail for each of 12, 13 and 14.

## What happens on every update
- You (or I) push to `main`. Cloudflare rebuilds and publishes by itself (about a minute or two).
- Phones that already have the app see **"A new version of ShuvroMed is ready"** the next time they open it or within about an hour. Nothing changes until they tap **Reload now**. Tapping **Later** keeps the old version until the next visit. This is deliberate so an update never interrupts a practice session.
- If a build fails, the old site keeps running. Open the Cloudflare project → **Deployments** to see why. To go back to an earlier version use **Deployments** → an older deployment → **Rollback to this deployment** (if the button is not shown, tell me).

## Files that control hosting (in `public/`, copied into the build)
- `_headers`: security headers (a strict Content-Security-Policy that allows only this site and `*.supabase.co`, no framing, no sniffing) and cache rules (`/assets/*` are cached for a year because file names contain a hash; `sw.js`, `index.html`, the manifest and `/content/*` must always be re-checked).
- `_redirects`: `/* /index.html 200` so a refresh on `/app/subjects` still opens the app.
- `robots.txt`: search engines may index the home page but not `/app`, `/login` or `/signup`.

## Custom domain (optional, later)
A `.pages.dev` address is free. A custom domain costs the domain price at a registrar (that is the only possible cost, and it is optional). Cloudflare Pages itself charges nothing for adding one.

## Known limits
- Supabase built-in email only reaches your own team email and is rate limited (see docs/AUTH_SETUP.md). Real students need a custom SMTP provider first: that is an owner decision about a possibly paid service, so I will not set it up without your approval.
- Keep-alive: `.github/workflows/keep-alive.yml` asks Supabase for one public row twice a week so the free project is less likely to pause. It has run in no real environment yet: after the push, open Actions → **Keep Supabase awake** → **Run workflow** once and check for a green tick. Whether this activity is enough to prevent a pause is **not verified**; if the project ever pauses, press **Restore project** in the Supabase dashboard.
