-- Close Plaid item uniqueness gap for manual-withdrawal bank records.
-- Safe to run multiple times.

alter table public.user_bank_accounts
  add column if not exists plaid_item_id text;

create unique index if not exists idx_user_bank_accounts_plaid_item_id
  on public.user_bank_accounts(plaid_item_id)
  where plaid_item_id is not null;
