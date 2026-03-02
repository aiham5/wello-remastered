-- Plaid link purpose separation for cashout vs receipt verification.
-- Safe to run multiple times.

alter table public.plaid_linked_items
  add column if not exists link_purposes text[] not null
    default array['cashout','receipt_verification']::text[];

alter table public.plaid_linked_accounts
  add column if not exists link_purposes text[] not null
    default array['cashout','receipt_verification']::text[];

update public.plaid_linked_items
set link_purposes = array['cashout','receipt_verification']::text[]
where link_purposes is null
   or cardinality(link_purposes) = 0;

update public.plaid_linked_accounts
set link_purposes = array['cashout','receipt_verification']::text[]
where link_purposes is null
   or cardinality(link_purposes) = 0;

alter table public.plaid_linked_items
  drop constraint if exists plaid_linked_items_link_purposes_check;

alter table public.plaid_linked_items
  add constraint plaid_linked_items_link_purposes_check
  check (
    cardinality(link_purposes) > 0
    and link_purposes <@ array['cashout','receipt_verification']::text[]
  );

alter table public.plaid_linked_accounts
  drop constraint if exists plaid_linked_accounts_link_purposes_check;

alter table public.plaid_linked_accounts
  add constraint plaid_linked_accounts_link_purposes_check
  check (
    cardinality(link_purposes) > 0
    and link_purposes <@ array['cashout','receipt_verification']::text[]
  );

create index if not exists plaid_linked_items_link_purposes_gin_idx
  on public.plaid_linked_items using gin (link_purposes);

create index if not exists plaid_linked_accounts_link_purposes_gin_idx
  on public.plaid_linked_accounts using gin (link_purposes);
