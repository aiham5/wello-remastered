-- Add Checkbook payout cache fields to support destination reuse.
-- Safe to run multiple times.

alter table public.plaid_linked_accounts
  add column if not exists checkbook_recipient_id text,
  add column if not exists checkbook_destination_id text;

alter table public.cashout_recipients
  add column if not exists checkbook_recipient_id text,
  add column if not exists checkbook_destination_id text;

create index if not exists plaid_linked_accounts_checkbook_recipient_id_idx
  on public.plaid_linked_accounts(checkbook_recipient_id)
  where checkbook_recipient_id is not null;

create index if not exists plaid_linked_accounts_checkbook_destination_id_idx
  on public.plaid_linked_accounts(checkbook_destination_id)
  where checkbook_destination_id is not null;

create index if not exists cashout_recipients_checkbook_recipient_id_idx
  on public.cashout_recipients(checkbook_recipient_id)
  where provider = 'checkbook' and checkbook_recipient_id is not null;

create index if not exists cashout_recipients_checkbook_destination_id_idx
  on public.cashout_recipients(checkbook_destination_id)
  where provider = 'checkbook' and checkbook_destination_id is not null;
