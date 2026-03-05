-- Final cleanup for legacy cashout providers and legacy webhook tables.
-- Apply this after the previous provider normalization migration.

-- Normalize any legacy values directly (defensive).
update public.cashout_payouts
set provider = case
  when provider in ('tremendous', 'giftbit') then 'reloadly'
  when provider in ('trolley', 'dots') then 'checkbook'
  else provider
end
where provider is not null
  and provider <> ''
  and provider not in ('stripe', 'reloadly', 'checkbook');

update public.cashout_recipients
set provider = 'checkbook'
where provider = 'trolley';

-- Rebuild payout provider constraint.
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
  check (provider in ('stripe', 'reloadly', 'checkbook'));

-- Rebuild recipient provider constraint.
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

-- Remove legacy provider webhook tables that are no longer used.
drop table if exists public.dots_webhook_events;
drop table if exists public.tremendous_webhook_events;
drop table if exists public.trolley_webhook_events;
