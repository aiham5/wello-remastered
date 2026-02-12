-- Plaid purchase verification with receipt fallback.
-- Safe to run multiple times.
--
-- Core rules:
-- - Plaid is verification-only (no payment initiation).
-- - Stripe remains payout/money-movement rail.
-- - Missing Plaid transaction visibility must fall back to receipt flow.

-- 1) Track verification source on receipt uploads (manual receipt vs Plaid auto-verified).
alter table public.receipt_uploads
  add column if not exists verification_source text not null default 'receipt';

alter table public.receipt_uploads
  drop constraint if exists receipt_uploads_verification_source_check;

alter table public.receipt_uploads
  add constraint receipt_uploads_verification_source_check
  check (verification_source in ('receipt', 'plaid'));

alter table public.receipt_uploads
  add column if not exists verification_reference text;

create index if not exists receipt_uploads_verification_source_idx
  on public.receipt_uploads(verification_source);

-- 2) Store linked Plaid items (service-role only access to tokens).
create table if not exists public.plaid_linked_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plaid_item_id text not null unique,
  plaid_access_token text,
  institution_id text,
  institution_name text,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'errored')),
  transactions_cursor text,
  available_products text[] not null default '{}'::text[],
  billed_products text[] not null default '{}'::text[],
  consent_expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_linked_items_user_id_idx
  on public.plaid_linked_items(user_id);
create index if not exists plaid_linked_items_status_idx
  on public.plaid_linked_items(status);

drop trigger if exists set_plaid_linked_items_updated_at on public.plaid_linked_items;
create trigger set_plaid_linked_items_updated_at
before update on public.plaid_linked_items
for each row execute function public.set_updated_at();

-- 3) Durable verification state per redemption.
create table if not exists public.purchase_verifications (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null unique references public.redemptions on delete cascade,
  receipt_upload_id uuid references public.receipt_uploads on delete set null,
  business_id uuid not null references public.businesses on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  source text not null default 'plaid'
    check (source in ('plaid', 'receipt')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  reason_code text
    check (
      reason_code is null
      or reason_code in (
        'bank_not_linked',
        'no_active_linked_account',
        'transaction_not_found',
        'transaction_pending',
        'transaction_delayed',
        'merchant_mismatch',
        'amount_mismatch',
        'identity_mismatch',
        'account_not_supported',
        'plaid_error',
        'receipt_required',
        'receipt_under_review',
        'receipt_approved',
        'receipt_rejected',
        'already_confirmed'
      )
    ),
  reason_detail text,
  expected_amount_cents integer check (expected_amount_cents is null or expected_amount_cents > 0),
  matched_amount_cents integer check (matched_amount_cents is null or matched_amount_cents > 0),
  expected_merchant text,
  matched_merchant text,
  expected_posted_on date,
  matched_posted_on date,
  matched_plaid_item_id text,
  matched_plaid_transaction_id text,
  last_checked_at timestamptz,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_verifications_matched_txn_uidx
  on public.purchase_verifications(matched_plaid_transaction_id)
  where matched_plaid_transaction_id is not null;
create index if not exists purchase_verifications_user_id_idx
  on public.purchase_verifications(user_id);
create index if not exists purchase_verifications_business_id_idx
  on public.purchase_verifications(business_id);
create index if not exists purchase_verifications_status_idx
  on public.purchase_verifications(status);

drop trigger if exists set_purchase_verifications_updated_at on public.purchase_verifications;
create trigger set_purchase_verifications_updated_at
before update on public.purchase_verifications
for each row execute function public.set_updated_at();

-- 4) Attempt logs (no card numbers/bank credentials).
create table if not exists public.purchase_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid references public.purchase_verifications(id) on delete set null,
  redemption_id uuid not null references public.redemptions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  business_id uuid references public.businesses on delete set null,
  attempt_source text not null default 'manual'
    check (attempt_source in ('manual', 'background', 'receipt_review')),
  outcome text not null
    check (outcome in ('matched_pending', 'matched_posted', 'no_match', 'error', 'already_confirmed')),
  reason_code text
    check (
      reason_code is null
      or reason_code in (
        'bank_not_linked',
        'no_active_linked_account',
        'transaction_not_found',
        'transaction_pending',
        'transaction_delayed',
        'merchant_mismatch',
        'amount_mismatch',
        'identity_mismatch',
        'account_not_supported',
        'plaid_error',
        'receipt_required',
        'receipt_under_review',
        'receipt_approved',
        'receipt_rejected',
        'already_confirmed'
      )
    ),
  expected_amount_cents integer check (expected_amount_cents is null or expected_amount_cents > 0),
  matched_amount_cents integer check (matched_amount_cents is null or matched_amount_cents > 0),
  expected_merchant text,
  matched_merchant text,
  expected_posted_on date,
  matched_posted_on date,
  matched_plaid_item_id text,
  matched_plaid_transaction_id text,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  posted_candidate_count integer not null default 0 check (posted_candidate_count >= 0),
  best_score integer,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_verification_attempts_redemption_id_idx
  on public.purchase_verification_attempts(redemption_id);
create index if not exists purchase_verification_attempts_user_id_idx
  on public.purchase_verification_attempts(user_id);
create index if not exists purchase_verification_attempts_created_at_idx
  on public.purchase_verification_attempts(created_at desc);

-- 5) Keep verification status aligned with receipt review outcomes.
create or replace function public.sync_purchase_verification_from_receipt_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text := 'pending';
  next_reason text := 'receipt_under_review';
  checked_at timestamptz := now();
begin
  if new.redemption_id is null then
    return new;
  end if;

  if new.review_status = 'verified' then
    next_status := 'confirmed';
    next_reason := 'receipt_approved';
    checked_at := coalesce(new.reviewed_at, now());
  elsif new.review_status = 'rejected' then
    next_status := 'rejected';
    next_reason := 'receipt_rejected';
    checked_at := coalesce(new.reviewed_at, now());
  end if;

  insert into public.purchase_verifications (
    redemption_id,
    receipt_upload_id,
    business_id,
    user_id,
    source,
    status,
    reason_code,
    reason_detail,
    expected_amount_cents,
    matched_amount_cents,
    expected_merchant,
    matched_merchant,
    expected_posted_on,
    matched_posted_on,
    last_checked_at,
    confirmed_at,
    rejected_at
  )
  values (
    new.redemption_id,
    new.id,
    new.business_id,
    new.user_id,
    'receipt',
    next_status,
    next_reason,
    case
      when next_status = 'pending' then 'Receipt uploaded and awaiting review.'
      when next_status = 'confirmed' then 'Receipt approved.'
      else 'Receipt rejected.'
    end,
    case when new.receipt_total_cents > 0 then new.receipt_total_cents else null end,
    case when new.receipt_total_cents > 0 then new.receipt_total_cents else null end,
    null,
    null,
    (new.uploaded_at at time zone 'utc')::date,
    (new.uploaded_at at time zone 'utc')::date,
    checked_at,
    case when next_status = 'confirmed' then checked_at else null end,
    case when next_status = 'rejected' then checked_at else null end
  )
  on conflict (redemption_id) do update
    set receipt_upload_id = excluded.receipt_upload_id,
        business_id = excluded.business_id,
        user_id = excluded.user_id,
        source = 'receipt',
        status = excluded.status,
        reason_code = excluded.reason_code,
        reason_detail = excluded.reason_detail,
        expected_amount_cents = coalesce(excluded.expected_amount_cents, purchase_verifications.expected_amount_cents),
        matched_amount_cents = coalesce(excluded.matched_amount_cents, purchase_verifications.matched_amount_cents),
        expected_posted_on = coalesce(excluded.expected_posted_on, purchase_verifications.expected_posted_on),
        matched_posted_on = coalesce(excluded.matched_posted_on, purchase_verifications.matched_posted_on),
        last_checked_at = excluded.last_checked_at,
        confirmed_at = case
          when excluded.status = 'confirmed' then coalesce(excluded.confirmed_at, purchase_verifications.confirmed_at, now())
          else purchase_verifications.confirmed_at
        end,
        rejected_at = case
          when excluded.status = 'rejected' then coalesce(excluded.rejected_at, purchase_verifications.rejected_at, now())
          else purchase_verifications.rejected_at
        end;

  return new;
end;
$$;

drop trigger if exists sync_purchase_verification_from_receipt_upload on public.receipt_uploads;
create trigger sync_purchase_verification_from_receipt_upload
after insert or update of review_status on public.receipt_uploads
for each row execute function public.sync_purchase_verification_from_receipt_upload();

-- 6) RLS.
alter table public.plaid_linked_items enable row level security;
alter table public.purchase_verifications enable row level security;
alter table public.purchase_verification_attempts enable row level security;

drop policy if exists "Users can read own purchase verifications"
  on public.purchase_verifications;
drop policy if exists "Staff can read purchase verifications"
  on public.purchase_verifications;
drop policy if exists "Staff can manage purchase verifications"
  on public.purchase_verifications;
drop policy if exists "Users can read own verification attempts"
  on public.purchase_verification_attempts;
drop policy if exists "Staff can read verification attempts"
  on public.purchase_verification_attempts;
drop policy if exists "Staff can read plaid linked items"
  on public.plaid_linked_items;

create policy "Users can read own purchase verifications"
on public.purchase_verifications for select
using (auth.uid() = user_id);

create policy "Staff can read purchase verifications"
on public.purchase_verifications for select
using (public.is_staff());

create policy "Staff can manage purchase verifications"
on public.purchase_verifications for update
using (public.is_staff())
with check (public.is_staff());

create policy "Users can read own verification attempts"
on public.purchase_verification_attempts for select
using (auth.uid() = user_id);

create policy "Staff can read verification attempts"
on public.purchase_verification_attempts for select
using (public.is_staff());

create policy "Staff can read plaid linked items"
on public.plaid_linked_items for select
using (public.is_staff());
