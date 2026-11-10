# Final checklist before real users

Done by me and checked by running: tests (app, database), lint, production build, offline in real Chromium, accessibility in real Chromium, security review update, backups workflow green, M6-M8 applied with approval.

## Owner actions still open
1. **Deploy to Cloudflare Pages** (free) by following `docs/DEPLOY.md`, "Owner steps (Android Chrome)". Why: until then the app only runs from the GitHub preview, which cannot send security headers.
2. **Tell Supabase where the site lives**: Supabase dashboard, Authentication, URL Configuration, set Site URL and Redirect URLs to your Cloudflare address (`docs/DEPLOY.md`, "Then tell Supabase where the site lives"). Why: email confirmation and password reset links point there.
3. **Real sign-ups**: Supabase's built-in email sender only reaches team addresses and has an hourly limit. Before inviting anyone else, a custom email sender must be set up (free options exist; tell me and I will prepare the steps).
4. **Phone check of Phase 10 and 11 on your phone**: open the installed app in airplane mode, add a question, practise, reload, then reconnect and press Sync now.
5. **Restore drill** once: `docs/RESTORE.md`, so you know the backup works before you need it.
6. Run **Keep Supabase awake** once (free projects pause after a week of no use).

## Known limits
- 20,000-question timing on a real phone is not measured (`docs/SCALE.md`).
- No iOS testing. No screen-reader test (axe finds about a third of problems).
- Leaked-password protection is off (not verified as free).
