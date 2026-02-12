-- Plaid -> Stripe cashout account selection.
-- Safe to run multiple times.
--
-- Goal:
-- - Keep Stripe as payout rail.
-- - Let users pick payout bank from linked Plaid accounts.
-- - Persist minimal metadata (no account/routing numbers).

create table if not exists public.plaid_linked_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plaid_item_id text not null references public.plaid_linked_items(plaid_item_id) on delete cascade,
  plaid_account_id text not null,
  account_name text,
  account_mask text,
  account_subtype text,
  account_type text,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists plaid_linked_accounts_item_account_uidx
  on public.plaid_linked_accounts(plaid_item_id, plaid_account_id);
create index if not exists plaid_linked_accounts_user_id_idx
  on public.plaid_linked_accounts(user_id);
create index if not exists plaid_linked_accounts_status_idx
  on public.plaid_linked_accounts(status);

drop trigger if exists set_plaid_linked_accounts_updated_at on public.plaid_linked_accounts;
create trigger set_plaid_linked_accounts_updated_at
before update on public.plaid_linked_accounts
for each row execute function public.set_updated_at();

alter table public.profiles
  add column if not exists stripe_cashout_plaid_item_id text,
  add column if not exists stripe_cashout_plaid_account_id text,
  add column if not exists stripe_cashout_account_label text,
  add column if not exists stripe_cashout_external_account_id text,
  add column if not exists stripe_cashout_bank_synced_at timestamptz;

create index if not exists profiles_stripe_cashout_plaid_account_id_idx
  on public.profiles(stripe_cashout_plaid_account_id);

alter table public.plaid_linked_accounts enable row level security;

drop policy if exists "Users can read own plaid linked accounts"
  on public.plaid_linked_accounts;
drop policy if exists "Staff can read plaid linked accounts"
  on public.plaid_linked_accounts;

create policy "Users can read own plaid linked accounts"
on public.plaid_linked_accounts for select
using (auth.uid() = user_id);

create policy "Staff can read plaid linked accounts"
on public.plaid_linked_accounts for select
using (public.is_staff());
