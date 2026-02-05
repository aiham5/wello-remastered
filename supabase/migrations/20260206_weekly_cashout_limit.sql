-- Weekly cashback payout support.
-- Safe to run multiple times.

create table if not exists public.cashout_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  stripe_account_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed')),
  stripe_transfer_id text,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cashout_payouts_user_id_idx
  on public.cashout_payouts(user_id);
create index if not exists cashout_payouts_status_idx
  on public.cashout_payouts(status);

alter table public.cashback_events
  add column if not exists payout_id uuid references public.cashout_payouts on delete set null;

create index if not exists cashback_events_payout_id_idx
  on public.cashback_events(payout_id);

drop trigger if exists set_cashout_payouts_updated_at on public.cashout_payouts;
create trigger set_cashout_payouts_updated_at
before update on public.cashout_payouts
for each row execute function public.set_updated_at();

alter table public.cashout_payouts enable row level security;

drop policy if exists "Users can read own cashout payouts"
  on public.cashout_payouts;
drop policy if exists "Staff can read cashout payouts"
  on public.cashout_payouts;
drop policy if exists "Staff can manage cashout payouts"
  on public.cashout_payouts;

create policy "Users can read own cashout payouts"
on public.cashout_payouts for select
using (auth.uid() = user_id);

create policy "Staff can read cashout payouts"
on public.cashout_payouts for select
using (public.is_staff());

create policy "Staff can manage cashout payouts"
on public.cashout_payouts for update
using (public.is_staff())
with check (public.is_staff());
