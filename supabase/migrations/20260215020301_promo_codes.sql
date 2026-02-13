-- Promo codes: allow higher cashback rates (as % of commission) for specific users.
-- Cashback is computed on verification and persisted per cashback_event so historical receipts don't change.

-- 1) Promo codes table (staff-managed).
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  cashback_rate_bps integer not null check (cashback_rate_bps > 0 and cashback_rate_bps <= 5000),
  active boolean not null default true,
  starts_at timestamptz null,
  ends_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness.
create unique index if not exists promo_codes_code_uidx on public.promo_codes (lower(code));
create index if not exists promo_codes_active_idx on public.promo_codes (active);

-- 2) Attach promo code to a user profile.
alter table public.profiles
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

create index if not exists profiles_promo_code_id_idx on public.profiles(promo_code_id);

-- 3) Persist applied rate on cashback events for auditability and stable history.
alter table public.cashback_events
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

alter table public.cashback_events
  add column if not exists cashback_rate_bps integer not null default 500;

create index if not exists cashback_events_promo_code_id_idx on public.cashback_events(promo_code_id);

-- 4) Recompute cashback based on user's active promo code (or default 5% = 500 bps).
--    This replaces the older fixed 5% calculation while preserving "paid" rows.
create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cashback_cents integer := 0;
  cashback_rate_bps integer := 500;
  promo_id uuid := null;
  promo_rate integer := null;
begin
  -- Resolve promo code for this user if present and active.
  if new.user_id is not null then
    select p.promo_code_id
      into promo_id
      from public.profiles p
      where p.id = new.user_id;

    if promo_id is not null then
      select pc.cashback_rate_bps
        into promo_rate
        from public.promo_codes pc
        where pc.id = promo_id
          and pc.active = true
          and (pc.starts_at is null or pc.starts_at <= now())
          and (pc.ends_at is null or pc.ends_at >= now());

      if promo_rate is not null and promo_rate > 0 then
        cashback_rate_bps := promo_rate;
      else
        promo_id := null;
      end if;
    end if;
  end if;

  if coalesce(new.commission_due_cents, 0) > 0 then
    cashback_cents := round((new.commission_due_cents::numeric) * (cashback_rate_bps::numeric) / 10000)::integer;
  end if;

  if new.review_status = 'verified'
     and new.commission_due_cents is not null
     and new.commission_due_cents > 0 then
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
      new.commission_due_cents,
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

-- 5) RLS for promo codes: staff only.
alter table public.promo_codes enable row level security;

drop policy if exists "promo_codes staff select" on public.promo_codes;
drop policy if exists "promo_codes staff write" on public.promo_codes;

create policy "promo_codes staff select"
on public.promo_codes for select
using (public.is_staff());

create policy "promo_codes staff write"
on public.promo_codes for all
using (public.is_staff())
with check (public.is_staff());

-- Keep updated_at fresh.
drop trigger if exists set_promo_codes_updated_at on public.promo_codes;
create trigger set_promo_codes_updated_at
before update on public.promo_codes
for each row execute function public.set_updated_at();

