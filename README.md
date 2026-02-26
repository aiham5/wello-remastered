# wello-remastered

## Wello Partners site (static hosting)
- Static site is in `site/`.
- Can be deployed on any static host.
- Stripe return URLs:
  - `/stripe/return`
  - `/stripe/refresh`
  - `/stripe/success`
  - `/stripe/cancel`

## Plaid Verification (business billing only)
- Stripe is used for business billing/payment method operations.
- Consumer cashback withdrawal is currently disabled while payout provider work is in progress.
- Plaid is used for purchase verification signals.
- If no confident Plaid match is found, users can upload receipts for review.

### Required Supabase Edge Function env vars
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV` (`sandbox`, `development`, or `production`)
- Optional:
  - `PLAID_CLIENT_NAME` (default: `Wello`)
  - `PLAID_COUNTRY_CODES` (default: `US`)
  - `PLAID_WEBHOOK_URL`
  - `PLAID_REDIRECT_URI`

### iOS Plaid Link setup (OAuth-safe)
- Set `PLAID_REDIRECT_URI` in Supabase Edge Function secrets (must be an `https://` URL registered in Plaid Dashboard).
- Build-time iOS associated domains are auto-derived from `PLAID_REDIRECT_URI` when available in app config env.
- Optional override for multiple domains:
  - `PLAID_IOS_ASSOCIATED_DOMAINS=applinks:yourdomain.com,applinks:www.yourdomain.com`
- For Wello production domain:
  - `PLAID_REDIRECT_URI=https://www.wellopartners.com/plaid-link`
  - `PLAID_IOS_ASSOCIATED_DOMAINS=applinks:www.wellopartners.com`
- Rebuild iOS dev client after changing these values:
  - `eas build --platform ios --profile development_device`
