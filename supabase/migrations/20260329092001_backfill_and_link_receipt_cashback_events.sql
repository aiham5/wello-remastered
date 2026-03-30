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
        receipt_upload_id,
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
        new.id,
        new.user_id,
        new.business_id,
        new.redemption_id,
        cashback_cents,
        'available',
        cashback_rate_bps,
        cashback_basis,
        platform_subsidy_cents,
        promo_id
      )
      on conflict (redemption_id) where redemption_id is not null do update
        set receipt_upload_id = coalesce(cashback_events.receipt_upload_id, excluded.receipt_upload_id),
            amount_cents = case
              when cashback_events.status in ('reserved', 'paid', 'reversed')
                then cashback_events.amount_cents
              else excluded.amount_cents
            end,
            user_id = excluded.user_id,
            business_id = excluded.business_id,
            cashback_rate_bps = excluded.cashback_rate_bps,
            cashback_basis = excluded.cashback_basis,
            platform_subsidy_cents = excluded.platform_subsidy_cents,
            promo_code_id = excluded.promo_code_id,
            status = case
              when cashback_events.status in ('reserved', 'paid', 'reversed')
                then cashback_events.status
              else 'available'
            end;
    end if;
  end if;

  return new;
end;
$$;

with verified_receipts as (
  select
    ru.id as receipt_upload_id,
    ru.redemption_id,
    ru.business_id,
    ru.user_id,
    ru.receipt_total_cents,
    ru.commission_due_cents,
    ru.promo_code_id,
    b.commission_rate_cents,
    b.default_cashback_rate_bps,
    public.is_trade_business_category(b.category_key, b.category_label) as is_trade_business
  from public.receipt_uploads ru
  join public.businesses b on b.id = ru.business_id
  where ru.review_status = 'verified'
),
computed as (
  select
    vr.receipt_upload_id,
    vr.redemption_id,
    vr.business_id,
    vr.user_id,
    case
      when vr.is_trade_business then 1000
      else public.resolve_business_receipt_charge_rate_cents(vr.commission_rate_cents) * 10
    end as charge_rate_bps,
    case
      when vr.is_trade_business then 600
      else greatest(
        0,
        least(
          coalesce(
            vr.default_cashback_rate_bps,
            public.resolve_business_default_cashback_rate_bps(vr.commission_rate_cents)
          ),
          public.resolve_business_receipt_charge_rate_cents(vr.commission_rate_cents) * 10
        )
      )
    end as default_cashback_rate_bps,
    vr.receipt_total_cents,
    vr.commission_due_cents,
    vr.promo_code_id,
    vr.is_trade_business
  from verified_receipts vr
),
computed_with_promo as (
  select
    c.*,
    case
      when c.is_trade_business then null
      else pc.cashback_rate_bps
    end as promo_rate_bps
  from computed c
  left join public.promo_codes pc on pc.id = c.promo_code_id
),
finalized as (
  select
    cwp.receipt_upload_id,
    cwp.redemption_id,
    cwp.business_id,
    cwp.user_id,
    case
      when coalesce(cwp.receipt_total_cents, 0) > 0 then floor((cwp.receipt_total_cents::numeric) * (cwp.charge_rate_bps::numeric) / 10000)::integer
      else greatest(coalesce(cwp.commission_due_cents, 0), 0)
    end as commission_cents,
    case
      when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 and coalesce(cwp.receipt_total_cents, 0) > 0 then cwp.promo_rate_bps
      else cwp.default_cashback_rate_bps
    end as cashback_rate_bps,
    case
      when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 then 'receipt_total'
      when cwp.is_trade_business then 'receipt_total'
      else 'receipt_total'
    end as cashback_basis,
    case
      when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 and coalesce(cwp.receipt_total_cents, 0) > 0 then floor((cwp.receipt_total_cents::numeric) * (cwp.promo_rate_bps::numeric) / 10000)::integer
      when coalesce(cwp.receipt_total_cents, 0) > 0 then floor((cwp.receipt_total_cents::numeric) * (
        case
          when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 then cwp.promo_rate_bps
          else cwp.default_cashback_rate_bps
        end
      )::numeric / 10000)::integer
      when greatest(coalesce(cwp.commission_due_cents, 0), 0) > 0 and cwp.charge_rate_bps > 0 then floor((greatest(coalesce(cwp.commission_due_cents, 0), 0)::numeric) * (
        case
          when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 then cwp.promo_rate_bps
          else cwp.default_cashback_rate_bps
        end
      )::numeric / (cwp.charge_rate_bps::numeric))::integer
      else 0
    end as raw_cashback_cents,
    case
      when cwp.promo_rate_bps is not null and cwp.promo_rate_bps > 0 then cwp.promo_code_id
      else null
    end as applied_promo_code_id,
    cwp.is_trade_business
  from computed_with_promo cwp
),
upsert_rows as (
  select
    f.receipt_upload_id,
    f.redemption_id,
    f.business_id,
    f.user_id,
    case
      when f.is_trade_business then least(f.raw_cashback_cents, 100000)
      else f.raw_cashback_cents
    end as cashback_cents,
    case
      when f.is_trade_business and least(f.raw_cashback_cents, 100000) < f.raw_cashback_cents then 'cashback_amount_capped'
      else f.cashback_basis
    end as cashback_basis,
    f.cashback_rate_bps,
    greatest(
      case
        when f.is_trade_business then least(f.raw_cashback_cents, 100000)
        else f.raw_cashback_cents
      end - f.commission_cents,
      0
    ) as platform_subsidy_cents,
    f.applied_promo_code_id
  from finalized f
  where (
    case
      when f.is_trade_business then least(f.raw_cashback_cents, 100000)
      else f.raw_cashback_cents
    end
  ) > 0
)
insert into public.cashback_events (
  receipt_upload_id,
  redemption_id,
  business_id,
  user_id,
  amount_cents,
  status,
  cashback_rate_bps,
  cashback_basis,
  platform_subsidy_cents,
  promo_code_id
)
select
  ur.receipt_upload_id,
  ur.redemption_id,
  ur.business_id,
  ur.user_id,
  ur.cashback_cents,
  'available',
  ur.cashback_rate_bps,
  ur.cashback_basis,
  ur.platform_subsidy_cents,
  ur.applied_promo_code_id
from upsert_rows ur
on conflict (redemption_id) where redemption_id is not null do update
  set receipt_upload_id = coalesce(cashback_events.receipt_upload_id, excluded.receipt_upload_id),
      amount_cents = case
        when cashback_events.status in ('reserved', 'paid', 'reversed')
          then cashback_events.amount_cents
        else excluded.amount_cents
      end,
      business_id = excluded.business_id,
      user_id = excluded.user_id,
      cashback_rate_bps = excluded.cashback_rate_bps,
      cashback_basis = excluded.cashback_basis,
      platform_subsidy_cents = excluded.platform_subsidy_cents,
      promo_code_id = excluded.promo_code_id,
      status = case
        when cashback_events.status in ('reserved', 'paid', 'reversed')
          then cashback_events.status
        else 'available'
      end;
