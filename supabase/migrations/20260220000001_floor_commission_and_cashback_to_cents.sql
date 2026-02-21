-- Keep global consumer cashback at 7.5% and ensure commission/cashback math
-- floors fractional cents instead of rounding up.

insert into public.app_settings (key, value_json, updated_at)
values (
  'consumer_cashback_rate_bps',
  jsonb_build_object('bps', 750),
  now()
)
on conflict (key)
do update set
  value_json = excluded.value_json,
  updated_at = excluded.updated_at;

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
  default_cashback_rate_bps integer := public.get_current_cashback_rate_bps();
  cashback_basis text := 'receipt_total';
  platform_subsidy_cents integer := 0;
  promo_id uuid := null;
  promo_rate integer := null;
  commission_rate_cents integer := 150;
  commission_rate_bps integer := 1500;
begin
  if new.business_id is not null then
    select b.commission_rate_cents
      into commission_rate_cents
      from public.businesses b
      where b.id = new.business_id;
  end if;

  if coalesce(commission_rate_cents, 0) not in (100, 150) then
    commission_rate_cents := 150;
  end if;

  commission_rate_bps := commission_rate_cents * 10;

  if coalesce(new.receipt_total_cents, 0) > 0 then
    commission_cents := floor(
      (new.receipt_total_cents::numeric) * (commission_rate_bps::numeric) / 10000
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
    elsif commission_cents > 0 and commission_rate_bps > 0 then
      cashback_cents := floor(
        (commission_cents::numeric) * (cashback_rate_bps::numeric) / (commission_rate_bps::numeric)
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
