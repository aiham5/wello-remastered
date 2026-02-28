-- Swap bank-transfer provider from trolley -> checkbook while preserving history.
-- Safe to run after/without previous trolley rollout migration.

update public.cashout_payouts
set provider = 'checkbook'
where provider = 'trolley';

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
  add constraint cashout_payouts_provider_check
  check (
    provider in ('stripe', 'tremendous', 'dots', 'giftbit', 'reloadly', 'checkbook')
  );

update public.cashout_recipients
set provider = 'checkbook'
where provider = 'trolley';

update public.cashout_recipients
set recipient_status = 'linked',
    bank_summary = coalesce(nullif(bank_summary, ''), 'Checkbook transfer enabled'),
    updated_at = now()
where provider = 'checkbook'
  and coalesce(recipient_status, '') in ('', 'needs_onboarding');

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'cashout_recipients_provider_check'
      and conrelid = 'public.cashout_recipients'::regclass
  ) then
    alter table public.cashout_recipients
      drop constraint cashout_recipients_provider_check;
  end if;
end $$;

alter table public.cashout_recipients
  add constraint cashout_recipients_provider_check
  check (provider in ('checkbook'));

create table if not exists public.checkbook_webhook_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null unique,
  event_type text not null,
  signature_timestamp bigint,
  request_body_sha256 text not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists checkbook_webhook_events_created_idx
  on public.checkbook_webhook_events(created_at desc);

alter table public.checkbook_webhook_events enable row level security;
revoke all on table public.checkbook_webhook_events from anon, authenticated;

