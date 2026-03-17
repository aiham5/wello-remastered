-- Trades receipt payouts use a capped fixed schedule:
-- charge businesses 10% of up to $1,000 in receipt total
-- and return 6% cashback to the consumer on that same capped basis.

create or replace function public.is_trade_business_category(
  p_category_key text,
  p_category_label text
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text := regexp_replace(
    regexp_replace(lower(trim(coalesce(p_category_key, ''))), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)',
    '',
    'g'
  );
  v_label text := regexp_replace(
    regexp_replace(lower(trim(coalesce(p_category_label, ''))), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)',
    '',
    'g'
  );
begin
  if v_key <> '' then
    if v_key in ('activity', 'restaurant', 'drink', 'cafe') then
      return false;
    end if;
    if v_key in (
      'activities',
      'activities-entertainment',
      'entertainment',
      'restaurants',
      'restaurant-food',
      'food',
      'drinks',
      'cafes'
    ) then
      return false;
    end if;
    return true;
  end if;

  if v_label <> '' then
    if v_label in (
      'activity',
      'activities',
      'activities-entertainment',
      'entertainment',
      'restaurant',
      'restaurants',
      'restaurant-food',
      'food',
      'drinks',
      'drink',
      'cafe',
      'cafes'
    ) then
      return false;
    end if;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.receipt_uploads_set_commission_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_cents integer := null;
  eligible_total_cents integer := null;
  selected_commission_rate_cents integer := 150;
  charge_rate_cents integer := 100;
  charge_rate_bps integer := 1000;
  is_trade_business boolean := false;
begin
  total_cents := new.receipt_total_cents;

  if new.business_id is not null then
    select
      b.commission_rate_cents,
      public.is_trade_business_category(b.category_key, b.category_label)
    into
      selected_commission_rate_cents,
      is_trade_business
    from public.businesses b
    where b.id = new.business_id;
  end if;

  if is_trade_business then
    charge_rate_cents := 100;
    charge_rate_bps := 1000;
    eligible_total_cents := least(coalesce(total_cents, 0), 100000);
  else
    if coalesce(selected_commission_rate_cents, 0) not in (150, 200) then
      selected_commission_rate_cents := 150;
    end if;

    charge_rate_cents := public.resolve_business_receipt_charge_rate_cents(
      selected_commission_rate_cents
    );
    charge_rate_bps := charge_rate_cents * 10;
    eligible_total_cents := total_cents;
  end if;

  if eligible_total_cents is not null and eligible_total_cents > 0 then
    new.commission_due_cents := floor(
      (eligible_total_cents::numeric) * (charge_rate_bps::numeric) / 10000
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
  is_trade_business boolean := false;
  eligible_total_cents integer := 0;
begin
  if new.business_id is not null then
    select
      b.commission_rate_cents,
      public.is_trade_business_category(b.category_key, b.category_label)
    into
      selected_commission_rate_cents,
      is_trade_business
    from public.businesses b
    where b.id = new.business_id;
  end if;

  if is_trade_business then
    charge_rate_cents := 100;
    charge_rate_bps := 1000;
    default_cashback_rate_bps := 600;
    eligible_total_cents := least(coalesce(new.receipt_total_cents, 0), 100000);
    cashback_basis := case
      when coalesce(new.receipt_total_cents, 0) > 100000 then 'receipt_total_capped'
      else 'receipt_total'
    end;
  else
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
    eligible_total_cents := coalesce(new.receipt_total_cents, 0);
    cashback_basis := 'receipt_total';
  end if;

  if eligible_total_cents > 0 then
    commission_cents := floor(
      (eligible_total_cents::numeric) * (charge_rate_bps::numeric) / 10000
    )::integer;
  else
    commission_cents := greatest(coalesce(new.commission_due_cents, 0), 0);
  end if;

  promo_id := new.promo_code_id;
  if promo_id is not null and not is_trade_business then
    select pc.cashback_rate_bps
      into promo_rate
      from public.promo_codes pc
      where pc.id = promo_id;
  end if;

  if promo_rate is not null
     and promo_rate > 0
     and eligible_total_cents > 0 then
    cashback_rate_bps := promo_rate;
    cashback_basis := 'receipt_total';
    cashback_cents := floor(
      (eligible_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
    )::integer;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
  else
    cashback_rate_bps := default_cashback_rate_bps;
    if eligible_total_cents > 0 then
      cashback_cents := floor(
        (eligible_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
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
  v_is_trade_business boolean := false;
  v_eligible_total_cents integer := 0;
  v_cashback_basis text := 'receipt_total';
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
    select
      b.commission_rate_cents,
      public.is_trade_business_category(b.category_key, b.category_label)
    into
      v_selected_commission_rate_cents,
      v_is_trade_business
    from public.businesses b
    where b.id = v_receipt.business_id;
  end if;

  if v_is_trade_business then
    v_commission_rate_cents := 100;
    v_commission_rate_bps := 1000;
    v_default_cashback_rate_bps := 600;
    v_eligible_total_cents := least(p_receipt_total_cents, 100000);
    v_cashback_basis := case
      when p_receipt_total_cents > 100000 then 'receipt_total_capped'
      else 'receipt_total'
    end;
  else
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
    v_eligible_total_cents := p_receipt_total_cents;
    v_cashback_basis := 'receipt_total';
  end if;

  v_commission_cents := floor(
    (v_eligible_total_cents::numeric) * (v_commission_rate_bps::numeric) / 10000
  )::integer;

  if v_receipt.promo_code_id is not null and not v_is_trade_business then
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
    (v_eligible_total_cents::numeric) * (v_effective_cashback_rate_bps::numeric) / 10000
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
    v_cashback_basis,
    v_cashback_cents,
    v_platform_subsidy_cents;
end;
$$;

update public.receipt_uploads ru
set commission_due_cents = floor(
  (
    least(ru.receipt_total_cents, 100000)::numeric
  ) * 1000::numeric / 10000
)::integer
from public.businesses b
where ru.business_id = b.id
  and coalesce(ru.receipt_total_cents, 0) > 0
  and public.is_trade_business_category(b.category_key, b.category_label)
  and coalesce(ru.commission_due_cents, -1) is distinct from floor(
    (
      least(ru.receipt_total_cents, 100000)::numeric
    ) * 1000::numeric / 10000
  )::integer;
