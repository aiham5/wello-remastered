-- Cashout v2 tracking and webhook dedupe support.
-- Safe to run multiple times.

create table if not exists public.cashout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  stripe_account_id text not null,
  stripe_external_account_id text,
  plaid_item_id text,
  plaid_account_id text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  idempotency_key text not null,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'transfer_created',
        'payout_created',
        'paid',
        'failed'
      )
    ),
  stripe_transfer_id text,
  stripe_payout_id text,
  failure_code text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists cashout_requests_user_idempotency_uidx
  on public.cashout_requests(user_id, idempotency_key);
create unique index if not exists cashout_requests_stripe_transfer_uidx
  on public.cashout_requests(stripe_transfer_id)
  where stripe_transfer_id is not null;
create unique index if not exists cashout_requests_stripe_payout_uidx
  on public.cashout_requests(stripe_payout_id)
  where stripe_payout_id is not null;
create index if not exists cashout_requests_user_created_idx
  on public.cashout_requests(user_id, created_at desc);
create index if not exists cashout_requests_status_idx
  on public.cashout_requests(status);
drop trigger if exists set_cashout_requests_updated_at on public.cashout_requests;
create trigger set_cashout_requests_updated_at
before update on public.cashout_requests
for each row execute function public.set_updated_at();
create table if not exists public.cashout_transfers (
  id uuid primary key default gen_random_uuid(),
  cashout_request_id uuid not null references public.cashout_requests(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  stripe_transfer_id text not null,
  stripe_account_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  status text not null default 'created'
    check (status in ('created', 'reversed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cashout_transfers_stripe_transfer_uidx
  on public.cashout_transfers(stripe_transfer_id);
create index if not exists cashout_transfers_request_idx
  on public.cashout_transfers(cashout_request_id);
create index if not exists cashout_transfers_user_created_idx
  on public.cashout_transfers(user_id, created_at desc);
drop trigger if exists set_cashout_transfers_updated_at on public.cashout_transfers;
create trigger set_cashout_transfers_updated_at
before update on public.cashout_transfers
for each row execute function public.set_updated_at();
alter table public.cashout_payouts
  add column if not exists cashout_request_id uuid references public.cashout_requests(id) on delete set null,
  add column if not exists stripe_payout_id text,
  add column if not exists idempotency_key text,
  add column if not exists failure_code text;
create unique index if not exists cashout_payouts_stripe_payout_uidx
  on public.cashout_payouts(stripe_payout_id)
  where stripe_payout_id is not null;
create index if not exists cashout_payouts_request_idx
  on public.cashout_payouts(cashout_request_id);
create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_created_idx
  on public.stripe_webhook_events(created_at desc);
create table if not exists public.plaid_webhook_events (
  id uuid primary key default gen_random_uuid(),
  plaid_verification_iat bigint,
  request_body_sha256 text not null,
  webhook_type text,
  webhook_code text,
  plaid_item_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists plaid_webhook_events_iat_hash_uidx
  on public.plaid_webhook_events(plaid_verification_iat, request_body_sha256);
create index if not exists plaid_webhook_events_created_idx
  on public.plaid_webhook_events(created_at desc);
alter table public.profiles
  add column if not exists stripe_cashout_account_type text,
  add column if not exists stripe_cashout_requirements_disabled_reason text,
  add column if not exists stripe_cashout_requirements_due jsonb not null default '[]'::jsonb;
alter table public.cashout_requests enable row level security;
alter table public.cashout_transfers enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.plaid_webhook_events enable row level security;
drop policy if exists "Cashout requests select access" on public.cashout_requests;
create policy "Cashout requests select access"
on public.cashout_requests
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);
drop policy if exists "Cashout transfers select access" on public.cashout_transfers;
create policy "Cashout transfers select access"
on public.cashout_transfers
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);
revoke all on table public.stripe_webhook_events from anon, authenticated;
revoke all on table public.plaid_webhook_events from anon, authenticated;
