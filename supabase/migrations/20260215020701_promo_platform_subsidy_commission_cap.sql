-- Promo receipts: merchant commission is ALWAYS capped at 10% of receipt total.
-- Any customer discount/cashback above that 10% is funded by the platform, not the merchant.
--
-- This migration makes the logic:
-- - auditable (cashback_rate_bps + cashback_basis + platform_subsidy_cents persisted),
-- - fail-safe (DB computes commission for commission_events regardless of client input),
-- - visible pre-verify on the admin site (receipt_uploads.promo_code_id snapshot).
--
-- Safe to run multiple times.

-- 1) Snapshot applied promo on the receipt upload (so admins can see it before verifying).
alter table public.receipt_uploads
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

create index if not exists receipt_uploads_promo_code_id_idx
  on public.receipt_uploads(promo_code_id);

-- 2) Add audit columns to cashback_events.
alter table public.cashback_events
  add column if not exists cashback_basis text not null default 'commission'
    check (cashback_basis in ('commission', 'receipt_total'));

alter table public.cashback_events
  add column if not exists platform_subsidy_cents integer not null default 0
    check (platform_subsidy_cents >= 0);

-- 3) On insert, lock promo_code_id to the user's profile promo (and only if active at upload time).
-- This prevents clients from injecting arbitrary promo ids on receipt uploads.
create or replace function public.receipt_uploads_set_promo_code_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_promo_id uuid := null;
  at_time timestamptz := null;
begin
  if new.user_id is null then
    new.promo_code_id := null;
    return new;
  end if;

  at_time := coalesce(new.uploaded_at, now());

  select p.promo_code_id
    into profile_promo_id
    from public.profiles p
    where p.id = new.user_id;

  -- Default: no promo.
  new.promo_code_id := null;

  if profile_promo_id is null then
    return new;
  end if;

  -- Only apply if the promo is active in the promo window at upload time.
  if exists (
    select 1
      from public.promo_codes pc
      where pc.id = profile_promo_id
        and pc.active = true
        and (pc.starts_at is null or pc.starts_at <= at_time)
        and (pc.ends_at is null or pc.ends_at >= at_time)
  ) then
    new.promo_code_id := profile_promo_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_receipt_upload_promo_code_id on public.receipt_uploads;
create trigger set_receipt_upload_promo_code_id
before insert on public.receipt_uploads
for each row execute function public.receipt_uploads_set_promo_code_id();

-- 4) Commission is always 10% of receipt total when a total is present.
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
    new.commission_due_cents := round((total_cents::numeric) * 0.10)::integer;
  end if;
  return new;
end;
$$;

drop trigger if exists set_receipt_upload_commission_due on public.receipt_uploads;
create trigger set_receipt_upload_commission_due
before insert or update of receipt_total_cents, commission_due_cents on public.receipt_uploads
for each row execute function public.receipt_uploads_set_commission_due();

-- 5) Replace sync_commission_event(): enforce 10% merchant cap and promo discount funded by platform.
create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commission_cents integer := 0;
  cashback_cents integer := 0;
  cashback_rate_bps integer := 500; -- default: 5% of commission
  cashback_basis text := 'commission';
  platform_subsidy_cents integer := 0;
  promo_id uuid := null;
  promo_rate integer := null;
begin
  -- Commission is always 10% of receipt total when a total exists.
  if coalesce(new.receipt_total_cents, 0) > 0 then
    commission_cents := round((new.receipt_total_cents::numeric) * 0.10)::integer;
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

  -- Promo receipts: customer discount/cashback is a % of receipt total.
  -- Merchant is still charged only 10% (commission_cents), and the platform funds any excess.
  if promo_rate is not null
     and promo_rate > 0
     and coalesce(new.receipt_total_cents, 0) > 0 then
    cashback_rate_bps := promo_rate;
    cashback_basis := 'receipt_total';
    cashback_cents := round((new.receipt_total_cents::numeric) * (cashback_rate_bps::numeric) / 10000)::integer;
    platform_subsidy_cents := greatest(cashback_cents - commission_cents, 0);
  else
    -- No promo: preserve existing behavior (5% of commission).
    cashback_rate_bps := 500;
    cashback_basis := 'commission';
    if commission_cents > 0 then
      cashback_cents := round((commission_cents::numeric) * 0.05)::integer;
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

