-- Admin receipt workflow v2:
-- - authoritative preview math
-- - single decision mutation with concurrency + safe-lock rules
-- - perf indexes for admin queues

create index if not exists receipt_uploads_status_uploaded_idx
  on public.receipt_uploads(review_status, uploaded_at desc);

create index if not exists receipt_uploads_business_status_uploaded_idx
  on public.receipt_uploads(business_id, review_status, uploaded_at desc);

create index if not exists cashout_payouts_provider_status_created_idx
  on public.cashout_payouts(provider, status, created_at desc);

create or replace function public.admin_preview_receipt_outcome(
  p_receipt_id uuid,
  p_receipt_total_cents integer
)
returns table (
  receipt_id uuid,
  commission_rate_cents integer,
  commission_rate_bps integer,
  commission_cents integer,
  default_cashback_rate_bps integer,
  applied_promo_code_id uuid,
  applied_promo_code text,
  applied_promo_rate_bps integer,
  effective_cashback_rate_bps integer,
  cashback_basis text,
  cashback_cents integer,
  platform_subsidy_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_receipt public.receipt_uploads;
  v_commission_rate_cents integer := 150;
  v_commission_rate_bps integer := 1500;
  v_commission_cents integer := 0;
  v_default_cashback_rate_bps integer := public.get_current_cashback_rate_bps();
  v_promo_rate_bps integer := null;
  v_promo_code text := null;
  v_effective_cashback_rate_bps integer := 0;
  v_cashback_cents integer := 0;
  v_platform_subsidy_cents integer := 0;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_receipt_id is null then
    raise exception 'invalid_receipt_id';
  end if;

  if coalesce(p_receipt_total_cents, 0) <= 0 then
    raise exception 'invalid_receipt_total';
  end if;

  select *
    into v_receipt
    from public.receipt_uploads
    where id = p_receipt_id;

  if v_receipt.id is null then
    raise exception 'receipt_not_found';
  end if;

  if v_receipt.business_id is not null then
    select b.commission_rate_cents
      into v_commission_rate_cents
      from public.businesses b
      where b.id = v_receipt.business_id;
  end if;

  if coalesce(v_commission_rate_cents, 0) not in (100, 150) then
    v_commission_rate_cents := 150;
  end if;

  v_commission_rate_bps := v_commission_rate_cents * 10;
  v_commission_cents := floor(
    (p_receipt_total_cents::numeric) * (v_commission_rate_bps::numeric) / 10000
  )::integer;

  if v_receipt.promo_code_id is not null then
    select pc.cashback_rate_bps, pc.code
      into v_promo_rate_bps, v_promo_code
      from public.promo_codes pc
      where pc.id = v_receipt.promo_code_id;
  end if;

  if coalesce(v_promo_rate_bps, 0) > 0 then
    v_effective_cashback_rate_bps := v_promo_rate_bps;
  else
    v_effective_cashback_rate_bps := coalesce(v_default_cashback_rate_bps, 750);
    v_receipt.promo_code_id := null;
    v_promo_rate_bps := null;
    v_promo_code := null;
  end if;

  v_cashback_cents := floor(
    (p_receipt_total_cents::numeric) * (v_effective_cashback_rate_bps::numeric) / 10000
  )::integer;

  v_platform_subsidy_cents := greatest(v_cashback_cents - v_commission_cents, 0);

  return query
  select
    v_receipt.id,
    v_commission_rate_cents,
    v_commission_rate_bps,
    v_commission_cents,
    coalesce(v_default_cashback_rate_bps, 750),
    v_receipt.promo_code_id,
    v_promo_code,
    v_promo_rate_bps,
    v_effective_cashback_rate_bps,
    'receipt_total'::text,
    v_cashback_cents,
    v_platform_subsidy_cents;
end;
$$;

grant execute on function public.admin_preview_receipt_outcome(uuid, integer)
to authenticated;

create or replace function public.admin_update_receipt_decision(
  p_receipt_id uuid,
  p_action text,
  p_receipt_total_cents integer default null,
  p_review_notes text default null,
  p_expected_status text default null,
  p_expected_reviewed_at timestamptz default null
)
returns public.receipt_uploads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current public.receipt_uploads;
  v_row public.receipt_uploads;
  v_action text := lower(coalesce(p_action, ''));
  v_locked boolean := false;
  v_before jsonb;
  v_after jsonb;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if not (select public.is_staff()) then
    raise exception 'forbidden';
  end if;

  if p_receipt_id is null then
    raise exception 'invalid_receipt_id';
  end if;

  if v_action not in ('verify', 'reject', 'undo', 'edit') then
    raise exception 'invalid_action';
  end if;

  if v_action in ('verify', 'edit') and coalesce(p_receipt_total_cents, 0) <= 0 then
    raise exception 'invalid_receipt_total';
  end if;

  if coalesce(p_expected_status, '') = '' then
    raise exception 'missing_expected_status';
  end if;

  select *
    into v_current
    from public.receipt_uploads
    where id = p_receipt_id;

  if v_current.id is null then
    raise exception 'receipt_not_found';
  end if;

  if v_current.review_status <> p_expected_status then
    raise exception 'concurrency_conflict_status';
  end if;

  if (
    (p_expected_reviewed_at is null and v_current.reviewed_at is not null)
    or
    (p_expected_reviewed_at is not null and v_current.reviewed_at is distinct from p_expected_reviewed_at)
  ) then
    raise exception 'concurrency_conflict_reviewed_at';
  end if;

  if v_action = 'verify' and v_current.review_status <> 'pending' then
    raise exception 'invalid_transition';
  end if;

  if v_action = 'reject' and v_current.review_status <> 'pending' then
    raise exception 'invalid_transition';
  end if;

  if v_action = 'undo' and v_current.review_status not in ('verified', 'rejected') then
    raise exception 'invalid_transition';
  end if;

  if v_action = 'edit' and v_current.review_status <> 'verified' then
    raise exception 'invalid_transition';
  end if;

  if v_action in ('undo', 'edit') then
    select exists (
      select 1
      from public.commission_events ce
      where ce.redemption_id = v_current.redemption_id
        and ce.status in ('invoiced', 'paid')
    )
    or exists (
      select 1
      from public.cashback_events cbe
      where cbe.receipt_upload_id = v_current.id
        and cbe.status = 'paid'
    )
    into v_locked;

    if v_locked then
      raise exception 'receipt_locked_for_accounting';
    end if;
  end if;

  v_before := jsonb_build_object(
    'review_status', v_current.review_status,
    'receipt_total_cents', v_current.receipt_total_cents,
    'review_notes', v_current.review_notes,
    'reviewed_by', v_current.reviewed_by,
    'reviewed_at', v_current.reviewed_at
  );

  if v_action = 'verify' then
    update public.receipt_uploads
    set
      receipt_total_cents = p_receipt_total_cents,
      review_status = 'verified',
      review_notes = p_review_notes,
      reviewed_by = v_actor,
      reviewed_at = now()
    where id = p_receipt_id
      and review_status = p_expected_status
      and (
        (p_expected_reviewed_at is null and reviewed_at is null)
        or (p_expected_reviewed_at is not null and reviewed_at = p_expected_reviewed_at)
      )
    returning * into v_row;
  elsif v_action = 'reject' then
    update public.receipt_uploads
    set
      review_status = 'rejected',
      review_notes = p_review_notes,
      reviewed_by = v_actor,
      reviewed_at = now()
    where id = p_receipt_id
      and review_status = p_expected_status
      and (
        (p_expected_reviewed_at is null and reviewed_at is null)
        or (p_expected_reviewed_at is not null and reviewed_at = p_expected_reviewed_at)
      )
    returning * into v_row;
  elsif v_action = 'undo' then
    update public.receipt_uploads
    set
      review_status = 'pending',
      review_notes = coalesce(p_review_notes, review_notes),
      reviewed_by = null,
      reviewed_at = null
    where id = p_receipt_id
      and review_status = p_expected_status
      and (
        (p_expected_reviewed_at is null and reviewed_at is null)
        or (p_expected_reviewed_at is not null and reviewed_at = p_expected_reviewed_at)
      )
    returning * into v_row;
  else
    update public.receipt_uploads
    set
      receipt_total_cents = p_receipt_total_cents,
      review_notes = p_review_notes,
      reviewed_by = v_actor,
      reviewed_at = now()
    where id = p_receipt_id
      and review_status = p_expected_status
      and (
        (p_expected_reviewed_at is null and reviewed_at is null)
        or (p_expected_reviewed_at is not null and reviewed_at = p_expected_reviewed_at)
      )
    returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'concurrency_conflict_apply';
  end if;

  v_after := jsonb_build_object(
    'review_status', v_row.review_status,
    'receipt_total_cents', v_row.receipt_total_cents,
    'review_notes', v_row.review_notes,
    'reviewed_by', v_row.reviewed_by,
    'reviewed_at', v_row.reviewed_at
  );

  perform public.admin_write_action_log(
    case
      when v_action = 'verify' then 'receipt_verified'
      when v_action = 'reject' then 'receipt_rejected'
      when v_action = 'undo' then 'receipt_undone'
      else 'receipt_edited'
    end,
    'receipt_uploads',
    v_row.id::text,
    'success',
    v_before,
    v_after,
    jsonb_build_object('action', v_action)
  );

  return v_row;
end;
$$;

grant execute on function public.admin_update_receipt_decision(
  uuid,
  text,
  integer,
  text,
  text,
  timestamptz
)
to authenticated;
