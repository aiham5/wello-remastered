-- Commission/cashback model update:
-- - Merchant commission is fixed at 15% of receipt total.
-- - Default customer cashback is 50% of merchant commission (7.5% of receipt total).
-- - Promo cashback remains based on receipt total, with platform subsidy for any amount
--   above the merchant commission cap.
--
-- Safe to run multiple times.

-- Keep business-level display/default rate aligned with the platform policy (15%).
alter table public.businesses
  alter column commission_rate_cents set default 150;
update public.businesses
set commission_rate_cents = 150
where coalesce(commission_rate_cents, 0) <> 150;
-- Commission due is always 15% of receipt total when total is present.
create or replace function public.receipt_uploads_set_commission_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_cents integer := null;
begin
  total_cents := new.receipt_total_cents;
  if total_cents is not null and total_cents > 0 then
    new.commission_due_cents := round((total_cents::numeric) * 0.15)::integer;
  end if;
  return new;
end;
$$;
drop trigger if exists set_receipt_upload_commission_due on public.receipt_uploads;
create trigger set_receipt_upload_commission_due
before insert or update of receipt_total_cents, commission_due_cents on public.receipt_uploads
for each row execute function public.receipt_uploads_set_commission_due();
-- Enforce:
-- - commission = 15% of receipt total (if total exists)
-- - no promo cashback = 50% of commission
-- - promo cashback = promo % of receipt total, with platform subsidy above commission
create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_cents integer := 0;
  cashback_cents integer := 0;
  cashback_rate_bps integer := 5000; -- default: 50% of commission
  cashback_basis text := 'commission';
  platform_subsidy_cents integer := 0;
  promo_id uuid := null;
  promo_rate integer := null;
begin
  -- Commission is always 15% of receipt total when a total exists.
  if coalesce(new.receipt_total_cents, 0) > 0 then
    commission_cents := round((new.receipt_total_cents::numeric) * 0.15)::integer;
  else
    commission_cents := greatest(coalesce(new.commission_due_cents, 0), 0);
  end if;

  -- Determine applied promo for this receipt.
  promo_id := new.promo_code_id;
  if promo_id is not null then
    select pc.cashback_rate_bps
      into promo_rate
      from public.promo_codes pc
      where pc.id = promo_id;
  end if;

  -- Promo receipts: customer cashback is a % of receipt total.
  -- Merchant is still charged only 15% (commission_cents), and the platform funds any excess.
  if promo_rate is not null
     and promo_rate > 0
     and coalesce(new.receipt_total_cents, 0) > 0 then
    cashback_rate_bps := promo_rate;
    cashback_basis := 'receipt_total';
    cashback_cents := round((new.receipt_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000)::integer;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
  else
    -- No promo: cashback is half of merchant commission.
    cashback_rate_bps := 5000;
    cashback_basis := 'commission';
    if commission_cents > 0 then
      cashback_cents := round((commission_cents::numeric) * 0.50)::integer;
    end if;
    platform_subsidy_cents := 0;
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
-- Recompute commission_due_cents for existing rows with totals.
-- Trigger + sync logic above keeps commission/cashback events aligned while preserving paid/invoiced amounts.
update public.receipt_uploads ru
set commission_due_cents = round((ru.receipt_total_cents::numeric) * 0.15)::integer
where coalesce(ru.receipt_total_cents, 0) > 0
  and coalesce(ru.commission_due_cents, -1) <>
      round((ru.receipt_total_cents::numeric) * 0.15)::integer;
