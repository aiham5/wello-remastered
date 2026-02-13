-- Enable partial cashout amounts by allowing adjustment cashback rows and a reserved status.
-- Safe to run multiple times.

-- 1) Allow cashback rows that are not tied to a specific receipt/redemption (adjustments).
--    Keep uniqueness for receipt-backed rows via partial unique indexes.

alter table public.cashback_events
  alter column receipt_upload_id drop not null;

alter table public.cashback_events
  alter column redemption_id drop not null;

alter table public.cashback_events
  drop constraint if exists cashback_events_receipt_upload_id_key;

alter table public.cashback_events
  drop constraint if exists cashback_events_redemption_id_key;

create unique index if not exists cashback_events_receipt_upload_id_uidx
  on public.cashback_events(receipt_upload_id)
  where receipt_upload_id is not null;

create unique index if not exists cashback_events_redemption_id_uidx
  on public.cashback_events(redemption_id)
  where redemption_id is not null;

alter table public.cashback_events
  add column if not exists source text not null default 'receipt';

alter table public.cashback_events
  drop constraint if exists cashback_events_source_check;

alter table public.cashback_events
  add constraint cashback_events_source_check
  check (source in ('receipt', 'adjustment'));

alter table public.cashback_events
  add column if not exists parent_event_id uuid references public.cashback_events(id) on delete set null;

-- 2) Add a reserved status so we can atomically reserve rows before Stripe transfer.
alter table public.cashback_events
  drop constraint if exists cashback_events_status_check;

alter table public.cashback_events
  add constraint cashback_events_status_check
  check (status in ('available', 'reserved', 'paid', 'reversed'));

