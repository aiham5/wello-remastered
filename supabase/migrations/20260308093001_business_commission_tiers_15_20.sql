-- Move business approval tiers to 15% / 20% plans.
-- 15% plan -> 10% billed on receipt total, 10% default cashback.
-- 20% plan -> 15% billed on receipt total, 15% default cashback.

create or replace function public.resolve_business_receipt_charge_rate_cents(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_commission_rate_cents, 150) = 200 then 150
    else 100
  end;
$$;

create or replace function public.resolve_business_default_cashback_rate_bps(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_commission_rate_cents, 150) = 200 then 1500
    else 1000
  end;
$$;

alter table public.businesses
  alter column commission_rate_cents set default 150;

update public.businesses
set commission_rate_cents = 150
where coalesce(commission_rate_cents, 0) not in (150, 200);

alter table public.businesses
  drop constraint if exists businesses_commission_rate_cents_check;

alter table public.businesses
  add constraint businesses_commission_rate_cents_check
  check (commission_rate_cents in (150, 200));

create or replace function public.receipt_uploads_set_commission_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_cents integer := null;
  selected_commission_rate_cents integer := 150;
  charge_rate_cents integer := 100;
  charge_rate_bps integer := 1000;
begin
  total_cents := new.receipt_total_cents;

  if new.business_id is not null then
    select b.commission_rate_cents
      into selected_commission_rate_cents
      from public.businesses b
      where b.id = new.business_id;
  end if;

  if coalesce(selected_commission_rate_cents, 0) not in (150, 200) then
    selected_commission_rate_cents := 150;
  end if;

  charge_rate_cents := public.resolve_business_receipt_charge_rate_cents(
    selected_commission_rate_cents
  );
  charge_rate_bps := charge_rate_cents * 10;

  if total_cents is not null and total_cents > 0 then
    new.commission_due_cents := floor(
      (total_cents::numeric) * (charge_rate_bps::numeric) / 10000
    )::integer;
  end if;

  return new;
end;
$$;

create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_cents integer := 0;
  cashback_cents integer := 0;
  cashback_rate_bps integer := 0;
  default_cashback_rate_bps integer := 1000;
  cashback_basis text := 'receipt_total';
  platform_subsidy_cents integer := 0;
  promo_id uuid := null;
  promo_rate integer := null;
  selected_commission_rate_cents integer := 150;
  charge_rate_cents integer := 100;
  charge_rate_bps integer := 1000;
begin
  if new.business_id is not null then
    select b.commission_rate_cents
      into selected_commission_rate_cents
      from public.businesses b
      where b.id = new.business_id;
  end if;

  if coalesce(selected_commission_rate_cents, 0) not in (150, 200) then
    selected_commission_rate_cents := 150;
  end if;

  charge_rate_cents := public.resolve_business_receipt_charge_rate_cents(
    selected_commission_rate_cents
  );
  charge_rate_bps := charge_rate_cents * 10;
  default_cashback_rate_bps := public.resolve_business_default_cashback_rate_bps(
    selected_commission_rate_cents
  );

  if coalesce(new.receipt_total_cents, 0) > 0 then
    commission_cents := floor(
      (new.receipt_total_cents::numeric) * (charge_rate_bps::numeric) / 10000
    )::integer;
  else
    commission_cents := greatest(coalesce(new.commission_due_cents, 0), 0);
  end if;

  promo_id := new.promo_code_id;
  if promo_id is not null then
    select pc.cashback_rate_bps
      into promo_rate
      from public.promo_codes pc
      where pc.id = promo_id;
  end if;

  if promo_rate is not null
     and promo_rate > 0
     and coalesce(new.receipt_total_cents, 0) > 0 then
    cashback_rate_bps := promo_rate;
    cashback_basis := 'receipt_total';
    cashback_cents := floor(
      (new.receipt_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
    )::integer;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
  else
    cashback_rate_bps := default_cashback_rate_bps;
    cashback_basis := 'receipt_total';
    if coalesce(new.receipt_total_cents, 0) > 0 then
      cashback_cents := floor(
        (new.receipt_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
      )::integer;
    elsif commission_cents > 0 and charge_rate_bps > 0 then
      cashback_cents := floor(
        (commission_cents::numeric) * (cashback_rate_bps::numeric) / (charge_rate_bps::numeric)
      )::integer;
    end if;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
    promo_id := null;
  end if;

  if new.review_status = 'verified'
     and commission_cents > 0 then
    insert into public.commission_events (
      business_id,
      redemption_id,
      user_id,
      amount_cents,
      status
    )
    values (
      new.business_id,
      new.redemption_id,
      new.user_id,
      commission_cents,
      'pending'
    )
    on conflict (redemption_id) do update
      set amount_cents = case
            when commission_events.status in ('invoiced', 'paid')
              then commission_events.amount_cents
            else excluded.amount_cents
          end,
          business_id = excluded.business_id,
          user_id = excluded.user_id,
          status = case
            when commission_events.status in ('invoiced', 'paid')
              then commission_events.status
            else 'pending'
          end;
  else
    update public.commission_events
      set status = 'failed'
      where redemption_id = new.redemption_id
        and status = 'pending';
  end if;

  if new.review_status = 'verified' and cashback_cents > 0 then
    insert into public.cashback_events (
      receipt_upload_id,
      redemption_id,
      business_id,
      user_id,
      amount_cents,
      cashback_rate_bps,
      promo_code_id,
      cashback_basis,
      platform_subsidy_cents,
      status
    )
    values (
      new.id,
      new.redemption_id,
      new.business_id,
      new.user_id,
      cashback_cents,
      cashback_rate_bps,
      promo_id,
      cashback_basis,
      platform_subsidy_cents,
      'available'
    )
    on conflict (receipt_upload_id) where receipt_upload_id is not null do update
      set amount_cents = case
            when cashback_events.status = 'paid'
              then cashback_events.amount_cents
            else excluded.amount_cents
          end,
          cashback_rate_bps = case
            when cashback_events.status = 'paid'
              then cashback_events.cashback_rate_bps
            else excluded.cashback_rate_bps
          end,
          promo_code_id = case
            when cashback_events.status = 'paid'
              then cashback_events.promo_code_id
            else excluded.promo_code_id
          end,
          cashback_basis = case
            when cashback_events.status = 'paid'
              then cashback_events.cashback_basis
            else excluded.cashback_basis
          end,
          platform_subsidy_cents = case
            when cashback_events.status = 'paid'
              then cashback_events.platform_subsidy_cents
            else excluded.platform_subsidy_cents
          end,
          redemption_id = excluded.redemption_id,
          business_id = excluded.business_id,
          user_id = excluded.user_id,
          status = case
            when cashback_events.status = 'paid'
              then cashback_events.status
            else 'available'
          end;
  else
    update public.cashback_events
      set status = 'reversed'
      where receipt_upload_id = new.id
        and status = 'available';
  end if;

  return new;
end;
$$;

create or replace function public.admin_preview_receipt_outcome(
  p_receipt_id uuid,
  p_receipt_total_cents integer
)
returns table(
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
  v_selected_commission_rate_cents integer := 150;
  v_commission_rate_cents integer := 100;
  v_commission_rate_bps integer := 1000;
  v_commission_cents integer := 0;
  v_default_cashback_rate_bps integer := 1000;
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
      into v_selected_commission_rate_cents
      from public.businesses b
      where b.id = v_receipt.business_id;
  end if;

  if coalesce(v_selected_commission_rate_cents, 0) not in (150, 200) then
    v_selected_commission_rate_cents := 150;
  end if;

  v_commission_rate_cents := public.resolve_business_receipt_charge_rate_cents(
    v_selected_commission_rate_cents
  );
  v_commission_rate_bps := v_commission_rate_cents * 10;
  v_default_cashback_rate_bps := public.resolve_business_default_cashback_rate_bps(
    v_selected_commission_rate_cents
  );
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
    v_effective_cashback_rate_bps := v_default_cashback_rate_bps;
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
    v_default_cashback_rate_bps,
    v_receipt.promo_code_id,
    v_promo_code,
    v_promo_rate_bps,
    v_effective_cashback_rate_bps,
    'receipt_total'::text,
    v_cashback_cents,
    v_platform_subsidy_cents;
end;
$$;

grant execute on function public.resolve_business_receipt_charge_rate_cents(integer)
to anon, authenticated, service_role;

grant execute on function public.resolve_business_default_cashback_rate_bps(integer)
to anon, authenticated, service_role;

