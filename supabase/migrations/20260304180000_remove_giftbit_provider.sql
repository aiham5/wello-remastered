-- Aggressive cleanup for remaining giftbit references in active cashout tables.

-- Normalize any lingering giftbit values to the active gift card provider.
update public.cashout_payouts
set provider = 'reloadly'
where provider = 'giftbit';

update public.cashout_payouts
set provider = case
  when provider = 'giftbit' then 'reloadly'
  when provider = 'giftbit' then 'reloadly'
  else provider
end
where provider = 'giftbit';

-- Rebuild payout provider constraint defensively.
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

-- Keep recipient table scoped to active provider.
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
