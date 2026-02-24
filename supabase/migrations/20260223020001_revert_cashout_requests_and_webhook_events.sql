-- Roll back cashout v2 tracking + webhook dedupe schema additions.
-- This intentionally removes related data.

drop policy if exists "Cashout transfers select access" on public.cashout_transfers;
drop policy if exists "Cashout requests select access" on public.cashout_requests;

drop trigger if exists set_cashout_transfers_updated_at on public.cashout_transfers;
drop trigger if exists set_cashout_requests_updated_at on public.cashout_requests;

drop index if exists public.cashout_payouts_stripe_payout_uidx;
drop index if exists public.cashout_payouts_request_idx;

alter table if exists public.cashout_payouts
  drop column if exists cashout_request_id,
  drop column if exists stripe_payout_id,
  drop column if exists idempotency_key,
  drop column if exists failure_code;

drop table if exists public.cashout_transfers;
drop table if exists public.cashout_requests;
drop table if exists public.stripe_webhook_events;
drop table if exists public.plaid_webhook_events;

alter table if exists public.profiles
  drop column if exists stripe_cashout_account_type,
  drop column if exists stripe_cashout_requirements_disabled_reason,
  drop column if exists stripe_cashout_requirements_due;
