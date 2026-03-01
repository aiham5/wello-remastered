# Wello Admin App (Isolated Cloudflare + Zero Trust)

This app is the dedicated admin surface, separated from the main website.

## What Changed
- Admin UI source is now in `admin-app/frontend` (Figma-generated React/Vite app).
- Admin UI build output runs from `admin-app/public`.
- Admin API runs on Cloudflare Pages Functions under `admin-app/functions/api/admin/[[path]].js`.
- Browser no longer uses Supabase auth/session for admin operations.
- Every API call is authorized by:
  1. Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`)
  2. Supabase role check (`profiles.role in ('admin','supervisor')`)

Legacy fallback:
- Previous admin UI is preserved in `admin-app/public/admin-legacy`.
- Previous root shell is preserved as `admin-app/public/index.legacy.html`.

## Required Cloudflare Access Setup
1. Create Access application for `https://ADMIN_HOST/*`.
2. Login method: OTP.
3. Add allowlist policy for approved staff emails.
4. Copy Access AUD value into `CF_ACCESS_AUD`.
5. Set `CF_ACCESS_TEAM_DOMAIN` to your team domain (for example `myteam.cloudflareaccess.com`).

## Required Env/Secrets
Set on the admin Pages project:
- `SUPABASE_URL`
- `ADMIN_SUPABASE_SECRET_KEY` (secret, server-only)
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `ADMIN_ALLOWED_EMAILS` (optional)
- `ADMIN_CORS_ORIGIN` (optional)
- `R2_ENDPOINT` (required if receipt `storage_path` uses `receipts/...`)
- `R2_BUCKET` (required if receipt `storage_path` uses `receipts/...`)
- `R2_ACCESS_KEY_ID` (secret, required for R2-signed receipt URLs)
- `R2_SECRET_ACCESS_KEY` (secret, required for R2-signed receipt URLs)

Backward compatibility:
- `SUPABASE_SECRET_KEY` is accepted as a fallback.
- `SUPABASE_SERVICE_ROLE_KEY` is still accepted as a fallback.

## Deploy
Build frontend first:
```bash
cd frontend
npm i
npm run build
```

Then publish the output in `public/`.

From `admin-app/`:
```bash
wrangler pages deploy public --project-name admin-panel
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
