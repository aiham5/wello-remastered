create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_cents integer := 0;
  cashback_cents integer := 0;
  raw_cashback_cents integer := 0;
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
    eligible_total_cents := coalesce(new.receipt_total_cents, 0);
    cashback_basis := 'receipt_total';
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
    raw_cashback_cents := floor(
      (eligible_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
    )::integer;
    cashback_cents := raw_cashback_cents;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
  else
    cashback_rate_bps := default_cashback_rate_bps;
    if eligible_total_cents > 0 then
      raw_cashback_cents := floor(
        (eligible_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000
      )::integer;
    elsif commission_cents > 0 and charge_rate_bps > 0 then
      raw_cashback_cents := floor(
        (commission_cents::numeric) * (cashback_rate_bps::numeric) / (charge_rate_bps::numeric)
      )::integer;
    end if;
    cashback_cents := case
      when is_trade_business then least(raw_cashback_cents, 100000)
      else raw_cashback_cents
    end;
    cashback_basis := case
      when is_trade_business and cashback_cents < raw_cashback_cents then 'cashback_amount_capped'
      else cashback_basis
    end;
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
      on conflict (redemption_id) where redemption_id is not null do update
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
