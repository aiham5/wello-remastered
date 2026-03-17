alter table public.businesses
  add column if not exists default_cashback_rate_bps integer;

update public.businesses
set commission_rate_cents = greatest(10, least(1000, coalesce(commission_rate_cents, 150)));

create or replace function public.resolve_business_receipt_charge_rate_cents(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select greatest(10, least(1000, coalesce(p_commission_rate_cents, 150)));
$$;

create or replace function public.resolve_business_default_cashback_rate_bps(
  p_commission_rate_cents integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when greatest(10, least(1000, coalesce(p_commission_rate_cents, 150))) = 100 then 600
    when greatest(10, least(1000, coalesce(p_commission_rate_cents, 150))) = 150 then 1000
    when greatest(10, least(1000, coalesce(p_commission_rate_cents, 150))) = 200 then 1500
    else greatest(
      0,
      least(
        greatest(10, least(1000, coalesce(p_commission_rate_cents, 150))) * 10,
        (greatest(10, least(1000, coalesce(p_commission_rate_cents, 150))) - 50) * 10
      )
    )
  end;
$$;

update public.businesses
set default_cashback_rate_bps = greatest(
  0,
  least(
    coalesce(
      default_cashback_rate_bps,
      public.resolve_business_default_cashback_rate_bps(commission_rate_cents)
    ),
    public.resolve_business_receipt_charge_rate_cents(commission_rate_cents) * 10
  )
);

alter table public.businesses
  alter column commission_rate_cents set default 150,
  alter column default_cashback_rate_bps set default 1000,
  alter column default_cashback_rate_bps set not null;

alter table public.businesses
  drop constraint if exists businesses_commission_rate_cents_check;

alter table public.businesses
  add constraint businesses_commission_rate_cents_check
  check (commission_rate_cents between 10 and 1000);

alter table public.businesses
  drop constraint if exists businesses_default_cashback_rate_bps_check;

alter table public.businesses
  add constraint businesses_default_cashback_rate_bps_check
  check (
    default_cashback_rate_bps >= 0
    and default_cashback_rate_bps <= (commission_rate_cents * 10)
  );

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
    selected_commission_rate_cents := public.resolve_business_receipt_charge_rate_cents(
      selected_commission_rate_cents
    );
    charge_rate_cents := selected_commission_rate_cents;
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
  selected_default_cashback_rate_bps integer := 1000;
  charge_rate_cents integer := 100;
  charge_rate_bps integer := 1000;
  is_trade_business boolean := false;
  eligible_total_cents integer := 0;
begin
  if new.business_id is not null then
    select
      b.commission_rate_cents,
      b.default_cashback_rate_bps,
      public.is_trade_business_category(b.category_key, b.category_label)
    into
      selected_commission_rate_cents,
      selected_default_cashback_rate_bps,
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
    selected_commission_rate_cents := public.resolve_business_receipt_charge_rate_cents(
      selected_commission_rate_cents
    );
    charge_rate_cents := selected_commission_rate_cents;
    charge_rate_bps := charge_rate_cents * 10;
    default_cashback_rate_bps := greatest(
      0,
      least(
        coalesce(
          selected_default_cashback_rate_bps,
          public.resolve_business_default_cashback_rate_bps(
            selected_commission_rate_cents
          )
        ),
        charge_rate_bps
      )
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
          user_id = excluded.user_id;

    if cashback_cents > 0 then
      insert into public.cashback_events (
        user_id,
        business_id,
        redemption_id,
        amount_cents,
        status,
        cashback_rate_bps,
        cashback_basis,
        platform_subsidy_cents,
        promo_code_id
      )
      values (
        new.user_id,
        new.business_id,
        new.redemption_id,
        cashback_cents,
        'pending',
        cashback_rate_bps,
        cashback_basis,
        platform_subsidy_cents,
        promo_id
      )
      on conflict (redemption_id) do update
        set amount_cents = case
              when cashback_events.status in ('paid', 'reversed')
                then cashback_events.amount_cents
              else excluded.amount_cents
            end,
            user_id = excluded.user_id,
            business_id = excluded.business_id,
            cashback_rate_bps = excluded.cashback_rate_bps,
            cashback_basis = excluded.cashback_basis,
            platform_subsidy_cents = excluded.platform_subsidy_cents,
            promo_code_id = excluded.promo_code_id;
    end if;
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
  v_selected_default_cashback_rate_bps integer := 1000;
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
      b.default_cashback_rate_bps,
      public.is_trade_business_category(b.category_key, b.category_label)
    into
      v_selected_commission_rate_cents,
      v_selected_default_cashback_rate_bps,
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
    v_selected_commission_rate_cents := public.resolve_business_receipt_charge_rate_cents(
      v_selected_commission_rate_cents
    );
    v_commission_rate_cents := v_selected_commission_rate_cents;
    v_commission_rate_bps := v_commission_rate_cents * 10;
    v_default_cashback_rate_bps := greatest(
      0,
      least(
        coalesce(
          v_selected_default_cashback_rate_bps,
          public.resolve_business_default_cashback_rate_bps(
            v_selected_commission_rate_cents
          )
        ),
        v_commission_rate_bps
      )
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
