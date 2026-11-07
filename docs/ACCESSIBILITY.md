# Accessibility

Target: WCAG 2.2 AA where it can be checked automatically, plus sensible keyboard and screen-reader structure. This is **not** a claim of full WCAG conformance: automatic tools find only part of the problems.

## Automatically checked (axe-core 4.11 in real Chromium, 360px wide, `scripts/check-a11y.cjs`)
40 screens, light and dark: landing, sign in, sign up, forgot password, not-found, dashboard, subjects, subject topics, revision, bookmarks, notebook, practice setup, practice question, answered question with explanation, finish step, mock setup, mock running, progress, analytics, settings. Rule sets: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice. **Result: 0 violations.** Lighthouse (mobile) accessibility: 100 on the home and sign-in pages.

## Problems the first audit found, now fixed
- No `main` landmark on the home, sign-in, sign-up and password pages (added).
- Practice and mock-exam screens had no level-one heading (hidden h1 added).
- Topic headings skipped from h1 to h3 (levels now follow the nesting).
- Locked badges were faded with opacity so their text failed contrast (faded style removed; dashed border instead).
- "Page not found" was a placeholder saying "Not built yet… planned for never" (replaced by a real page with links back).

## Added in Phase 8
- **Skip link**: first Tab stop on every signed-in page, jumps to the main content.
- **Page change announcements**: after a link is followed the tab title changes to the page heading and focus moves to the main area, so screen readers read the new page. The first load is left alone.
- Offline/online status is a live status line; update and offline notices use `role="status"`.

## Already in place from earlier phases
Visible 3px focus ring; touch targets at least 48px; every field labelled; errors announced with `role="alert"`; `prefers-reduced-motion` honoured; light, dark and "match my phone" themes with contrast chosen from tokens; radio groups use real fieldset/legend; question navigator buttons carry spoken state ("Question 3, answered, flagged"); information is never colour-only.

## Tests in the normal suite
`src/test/a11y-ui.test.tsx`: announcer sets title and focus (and not on first load), skip link works by keyboard, one main and one h1 on public pages, no skipped heading levels, real not-found page.

## NOT done (be honest)
- **No screen-reader testing** (TalkBack on Android is the one to try). The owner can switch it on in Android Settings → Accessibility → TalkBack and try: sign in, one practice question, Settings.
- No testing with 200% text size / browser zoom beyond the responsive layout checks, no switch-access or voice-control testing.
- Questions are text only today (the question schema has no image field). When images or diagrams are added, each will need alt text, and the schema must require it.
- Real-user feedback is the missing half of accessibility work.
