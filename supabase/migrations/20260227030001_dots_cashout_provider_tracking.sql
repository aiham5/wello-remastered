-- Add Dots as a supported consumer cashout provider and create webhook dedupe storage.
-- Safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'cashout_payouts_provider_check'
      and conrelid = 'public.cashout_payouts'::regclass
  ) then
    alter table public.cashout_payouts
      drop constraint cashout_payouts_provider_check;
  end if;
end $$;

alter table public.cashout_payouts
  alter column provider set default 'stripe';

alter table public.cashout_payouts
  add constraint cashout_payouts_provider_check
  check (provider in ('stripe', 'tremendous', 'dots'));

create table if not exists public.dots_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  signature_timestamp bigint,
  request_body_sha256 text not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dots_webhook_events_created_idx
  on public.dots_webhook_events(created_at desc);

alter table public.dots_webhook_events enable row level security;

revoke all on table public.dots_webhook_events from anon, authenticated;
