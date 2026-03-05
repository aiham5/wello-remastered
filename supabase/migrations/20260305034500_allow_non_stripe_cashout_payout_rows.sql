-- Allow non-Stripe payout providers (checkbook/reloadly/manual) to write
-- cashout_payouts rows without a Stripe account id.
-- Safe to run multiple times.

alter table public.cashout_payouts
  alter column stripe_account_id drop not null;

