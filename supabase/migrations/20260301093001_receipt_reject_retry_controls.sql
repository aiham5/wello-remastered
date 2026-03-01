-- Admin-controlled receipt retry for rejected uploads.
-- Adds explicit retry flags and a secure user resubmission RPC.

alter table public.receipt_uploads
  add column if not exists retry_allowed boolean not null default false,
  add column if not exists retry_decided_by uuid references auth.users(id) on delete set null,
  add column if not exists retry_decided_at timestamptz;

create index if not exists receipt_uploads_retry_allowed_idx
  on public.receipt_uploads(review_status, retry_allowed, uploaded_at desc);

create or replace function public.user_resubmit_rejected_receipt(
  p_redemption_id uuid,
  p_storage_path text
)
returns public.receipt_uploads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.receipt_uploads;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if p_redemption_id is null then
    raise exception 'invalid_redemption_id';
  end if;

  if nullif(btrim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'invalid_storage_path';
  end if;

  if left(p_storage_path, 9) <> 'receipts/' then
    raise exception 'invalid_storage_path';
  end if;

  select ru.*
    into v_row
    from public.receipt_uploads ru
    join public.redemptions r on r.id = ru.redemption_id
    where ru.redemption_id = p_redemption_id
      and ru.user_id = v_actor
      and r.scanned_by = v_actor
    order by ru.uploaded_at desc
    limit 1;

  if v_row.id is null then
    raise exception 'receipt_not_found';
  end if;

  if coalesce(v_row.review_status, 'pending') <> 'rejected' then
    raise exception 'receipt_not_rejected';
  end if;

  if coalesce(v_row.retry_allowed, false) is not true then
    raise exception 'retry_not_allowed';
  end if;

  update public.receipt_uploads
  set
    storage_path = p_storage_path,
    uploaded_at = now(),
    review_status = 'pending',
    review_notes = null,
    reviewed_by = null,
    reviewed_at = null,
    receipt_total_cents = null,
    commission_due_cents = 0,
    retry_allowed = false,
    retry_decided_by = null,
    retry_decided_at = null
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.user_resubmit_rejected_receipt(uuid, text)
to authenticated;
