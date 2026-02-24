-- Tremendous cashout provider tracking, idempotency, and webhook dedupe.
-- Safe to run multiple times.

alter table public.cashout_payouts
  add column if not exists provider text not null default 'stripe'
    check (provider in ('stripe', 'tremendous')),
  add column if not exists provider_order_id text,
  add column if not exists provider_reward_id text,
  add column if not exists provider_claim_url text,
  add column if not exists provider_status text,
  add column if not exists idempotency_key text;

create unique index if not exists cashout_payouts_provider_order_uidx
  on public.cashout_payouts(provider_order_id)
  where provider_order_id is not null;

create unique index if not exists cashout_payouts_provider_reward_uidx
  on public.cashout_payouts(provider_reward_id)
  where provider_reward_id is not null;

create unique index if not exists cashout_payouts_user_provider_idempotency_uidx
  on public.cashout_payouts(user_id, provider, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.tremendous_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_uuid text not null unique,
  event_type text not null,
  signature_timestamp bigint,
  request_body_sha256 text not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tremendous_webhook_events_created_idx
  on public.tremendous_webhook_events(created_at desc);

alter table public.tremendous_webhook_events enable row level security;

revoke all on table public.tremendous_webhook_events from anon, authenticated;
