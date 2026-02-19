-- Track Plaid update-mode requirements triggered by webhooks.
-- Safe to run multiple times.

alter table public.plaid_linked_items
  add column if not exists update_mode_required boolean not null default false,
  add column if not exists update_mode_reason text,
  add column if not exists update_mode_detected_at timestamptz,
  add column if not exists new_accounts_available boolean not null default false,
  add column if not exists last_webhook_code text;

alter table public.plaid_linked_items
  drop constraint if exists plaid_linked_items_update_mode_reason_check;

alter table public.plaid_linked_items
  add constraint plaid_linked_items_update_mode_reason_check
  check (
    update_mode_reason is null
    or update_mode_reason in (
      'item_login_required',
      'pending_expiration',
      'pending_disconnect'
    )
  );

create index if not exists plaid_linked_items_update_mode_required_idx
  on public.plaid_linked_items(user_id)
  where update_mode_required = true;

create index if not exists plaid_linked_items_new_accounts_available_idx
  on public.plaid_linked_items(user_id)
  where new_accounts_available = true;
