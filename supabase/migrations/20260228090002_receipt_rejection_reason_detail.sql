-- Surface admin review notes to users when a receipt is rejected.
-- Keeps purchase_verifications.reason_detail aligned with receipt_uploads.review_notes.

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
  pending_detail text := 'Receipt uploaded and awaiting review.';
  confirmed_detail text := 'Receipt approved.';
  rejected_detail text := coalesce(
    nullif(btrim(coalesce(new.review_notes, '')), ''),
    'Receipt rejected.'
  );
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
      when next_status = 'pending' then pending_detail
      when next_status = 'confirmed' then confirmed_detail
      else rejected_detail
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

update public.purchase_verifications pv
set reason_detail = coalesce(
  nullif(btrim(coalesce(ru.review_notes, '')), ''),
  'Receipt rejected.'
)
from public.receipt_uploads ru
where ru.redemption_id = pv.redemption_id
  and ru.review_status = 'rejected'
  and pv.reason_code = 'receipt_rejected';
