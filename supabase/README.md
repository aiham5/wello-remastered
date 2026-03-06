# Supabase setup

1) Create a new Supabase project.
2) In the SQL editor, run `supabase/schema.sql`.
3) Copy your project URL and anon key into `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

4) Use `lib/supabase.js` in the app when you wire data fetching.

Stripe (commission billing):
- Deploy the Edge Functions in `supabase/functions/`:
  - `stripe-create-account-link`
  - `stripe-create-setup-session`
  - `stripe-webhook`
  - `stripe-create-monthly-invoices` (optional scheduled billing; bi-weekly period window)
- Set these secrets in Supabase:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `BILLING_CRON_SECRET` (or `PUSH_CRON_SECRET`) for scheduled bi-weekly invoice runs
  - `STRIPE_CONNECT_REFRESH_URL`
  - `STRIPE_CONNECT_RETURN_URL`
  - `STRIPE_CHECKOUT_SUCCESS_URL`
  - `STRIPE_CHECKOUT_CANCEL_URL`
- In Stripe, add the webhook URL for `stripe-webhook`.
- Schedule `stripe-create-monthly-invoices` bi-weekly (Supabase scheduled functions), sending header `x-cron-secret: <BILLING_CRON_SECRET>`.

Plaid webhooks:
- Deploy `plaid-webhook`.
- Set `PLAID_WEBHOOK_URL` to your deployed function URL:
  - `https://<project-ref>.functions.supabase.co/plaid-webhook`
  - Optional hardening: append `?secret=<PLAID_WEBHOOK_SECRET>`
- Optional hardening secret:
  - `PLAID_WEBHOOK_SECRET` (same value in function env and webhook URL query param, or sent via `x-plaid-webhook-secret` header).
- In Plaid Dashboard, set the webhook URL for your app/item setup.
- Test in sandbox using `/sandbox/item/fire_webhook` with webhook code `NEW_ACCOUNTS_AVAILABLE`.

Invite codes + roles:
- Re-run the updated `supabase/schema.sql` to create the `invites` table.
- The schema also adds a `consumer` role for regular users.
- Admins can generate one-time codes from the Admin tab in the app.
- If you already created `profiles`, run the `alter table` statements in the schema to update the role constraint.
- Ensure the `Profiles are insertable by owners` policy exists so sign-in can create profile rows.
- If you already created `invites` or `businesses`, run the `alter table` statements to add new columns.
