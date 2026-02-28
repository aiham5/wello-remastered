-- Unified consumer cashout model: Reloadly (gift cards) + Trolley (bank transfer).
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
  check (provider in ('stripe', 'tremendous', 'dots', 'giftbit', 'reloadly', 'trolley'));

alter table public.cashout_payouts
  add column if not exists method_type text not null default 'gift_card'
    check (method_type in ('gift_card', 'bank_transfer')),
  add column if not exists approval_status text not null default 'not_required'
    check (approval_status in ('not_required', 'pending', 'approved', 'rejected')),
  add column if not exists catalog_item_code text,
  add column if not exists catalog_item_name text,
  add column if not exists catalog_image_url text,
  add column if not exists recipient_provider_id text,
  add column if not exists bank_summary text,
  add column if not exists released_by uuid references auth.users(id) on delete set null,
  add column if not exists released_at timestamptz;

create index if not exists cashout_payouts_user_created_idx
  on public.cashout_payouts(user_id, created_at desc);

create index if not exists cashout_payouts_provider_status_created_idx
  on public.cashout_payouts(provider, status, created_at desc);

create index if not exists cashout_payouts_approval_status_idx
  on public.cashout_payouts(approval_status, created_at desc);

create unique index if not exists cashout_payouts_user_provider_idempotency_uq
  on public.cashout_payouts(user_id, provider, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.cashout_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null check (provider in ('trolley')),
  recipient_provider_id text not null,
  recipient_status text,
  bank_summary text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cashout_recipients_provider_status_idx
  on public.cashout_recipients(provider, recipient_status, updated_at desc);

drop trigger if exists set_cashout_recipients_updated_at on public.cashout_recipients;
create trigger set_cashout_recipients_updated_at
before update on public.cashout_recipients
for each row execute function public.set_updated_at();

alter table public.cashout_recipients enable row level security;

drop policy if exists "cashout recipients owner select" on public.cashout_recipients;
create policy "cashout recipients owner select"
on public.cashout_recipients
for select
to authenticated
using (
  (select auth.uid()) = user_id
);

revoke insert, update, delete on table public.cashout_recipients from anon, authenticated;

create table if not exists public.trolley_webhook_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null unique,
  event_type text not null,
  signature_timestamp bigint,
  request_body_sha256 text not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trolley_webhook_events_created_idx
  on public.trolley_webhook_events(created_at desc);

alter table public.trolley_webhook_events enable row level security;
revoke all on table public.trolley_webhook_events from anon, authenticated;
