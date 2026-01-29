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
  - `stripe-create-monthly-invoices` (optional scheduled billing)
- Set these secrets in Supabase:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_CONNECT_REFRESH_URL`
  - `STRIPE_CONNECT_RETURN_URL`
  - `STRIPE_CHECKOUT_SUCCESS_URL`
  - `STRIPE_CHECKOUT_CANCEL_URL`
- In Stripe, add the webhook URL for `stripe-webhook`.
- Schedule `stripe-create-monthly-invoices` monthly (Supabase scheduled functions).

Invite codes + roles:
- Re-run the updated `supabase/schema.sql` to create the `invites` table.
- The schema also adds a `consumer` role for regular users.
- Admins can generate one-time codes from the Admin tab in the app.
- If you already created `profiles`, run the `alter table` statements in the schema to update the role constraint.
- Ensure the `Profiles are insertable by owners` policy exists so sign-in can create profile rows.
- If you already created `invites` or `businesses`, run the `alter table` statements to add new columns.
