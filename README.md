# wello-remastered

## Wello Partners site (Netlify)
- Static site is in `site/`.
- Netlify publishes the `site` folder (`netlify.toml` included).
- Stripe return URLs:
  - `/stripe/return`
  - `/stripe/refresh`
  - `/stripe/success`
  - `/stripe/cancel`

## Plaid Verification (Stripe payouts unchanged)
- Stripe remains the payout and money movement rail.
- Plaid is used only for purchase verification signals.
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
