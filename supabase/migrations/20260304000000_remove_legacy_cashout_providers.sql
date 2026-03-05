-- Remove legacy providers from active tables and keep only active providers.
-- Run after existing cashout migrations.

-- Normalize historical provider values in payout rows.
update public.cashout_payouts
set provider = case
  when provider in ('tremendous', 'giftbit', 'dots') then 'reloadly'
  when provider in ('trolley', 'dots') then 'checkbook'
  else provider
end
where provider is not null
  and provider <> ''
  and provider not in ('stripe', 'reloadly', 'checkbook');

-- Normalize historical bank recipient provider values.
update public.cashout_recipients
set provider = 'checkbook'
where provider = 'trolley';

-- Enforce active payout providers.
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

-- Enforce active recipient providers.
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
