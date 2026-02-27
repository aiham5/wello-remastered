# Wello Admin App (Isolated Cloudflare + Zero Trust)

This app is the dedicated admin surface, separated from the main website.

## What Changed
- Admin UI runs from `admin-app/public`.
- Admin API runs on Cloudflare Pages Functions under `admin-app/functions/api/admin/[[path]].js`.
- Browser no longer uses Supabase auth/session for admin operations.
- Every API call is authorized by:
  1. Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`)
  2. Supabase role check (`profiles.role in ('admin','supervisor')`)

## Required Cloudflare Access Setup
1. Create Access application for `https://ADMIN_HOST/*`.
2. Login method: OTP.
3. Add allowlist policy for approved staff emails.
4. Copy Access AUD value into `CF_ACCESS_AUD`.
5. Set `CF_ACCESS_TEAM_DOMAIN` to your team domain (for example `myteam.cloudflareaccess.com`).

## Required Env/Secrets
Set on the admin Pages project:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret)
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `ADMIN_ALLOWED_EMAILS` (optional)
- `ADMIN_CORS_ORIGIN` (optional)

## Deploy
From `admin-app/`:
```bash
wrangler pages deploy public --project-name wello-admin-app
```

If you use direct Git-based Pages deploy, keep:
- static assets in `public/`
- functions in `functions/`

## Main Site Redirect Cutover
`site/_redirects` now points `/admin` and `/admin/*` to:
- `https://ADMIN_HOST/...`

Before deploying main site, replace `ADMIN_HOST` with your real admin domain.

## Database Migration
Apply:
- `supabase/migrations/20260227041001_admin_auth_events.sql`

This adds auth diagnostic logging table used by the admin API (`admin_auth_events`).

