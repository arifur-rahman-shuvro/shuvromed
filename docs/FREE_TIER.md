# Free-tier limits (verified 2026-11-06 from official pages)

These are limits, not "unlimited". Re-verify before relying on them; providers change terms.

## Supabase Free (https://supabase.com/pricing)
- Database: 500 MB
- File storage: 1 GB
- Monthly active users: 50,000
- Egress: 5 GB (+5 GB cached)
- Projects: 2 active
- **Projects pause after 1 week of inactivity** -> keep-alive + warning required
- **Automatic backups: not included on Free** -> we build our own encrypted backups

## Cloudflare Pages Free (https://developers.cloudflare.com/pages/platform/limits)
- Builds: 500 per month (1 at a time)
- Files per site: 20,000
- Max file size: 25 MiB per asset
- Projects: 100 per account; custom domains: 100 per project

## GitHub Actions Free plan (https://docs.github.com/billing/managing-billing-for-your-products/managing-billing-for-github-actions)
- Included compute: $12/month, about 2,000 Linux 2-core minutes on private repos
- Standard runners in PUBLIC repos are free
- Artifact storage 500 MB (shared with Packages); cache 10 GB per repo
- Decision: keep the repo public (no secrets in it) so CI/backup minutes are not a constraint; backup output stays encrypted.
