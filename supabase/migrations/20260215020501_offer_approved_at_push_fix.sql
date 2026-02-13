-- Make push notifications fire when an offer becomes approved (visible),
-- not when it is first created (often pending review).
--
-- Applies to:
-- - public.offers: add approved_at + trigger to set it on approval
-- - public.count_nearby_offers_since: use approved_at for "since" window

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'offers'
      and column_name = 'approved_at'
  ) then
    alter table public.offers
      add column approved_at timestamptz;
  end if;
end $$;

-- Backfill approved_at for already-approved offers so they can be considered by "since" logic.
-- Prefer updated_at if present; otherwise fallback to created_at.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'offers'
      and column_name = 'updated_at'
  ) then
    execute $q$
      update public.offers
      set approved_at = coalesce(approved_at, updated_at, created_at)
      where approval_status = 'approved'
    $q$;
  else
    execute $q$
      update public.offers
      set approved_at = coalesce(approved_at, created_at)
      where approval_status = 'approved'
    $q$;
  end if;
end $$;

create or replace function public.set_offer_approved_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.approval_status = 'approved'
     and (old.approval_status is distinct from 'approved')
  then
    new.approved_at := now();
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_set_offer_approved_at on public.offers;
create trigger trg_set_offer_approved_at
before update of approval_status on public.offers
for each row
execute function public.set_offer_approved_at();

-- Update nearby-offer helper to use approval time.
create or replace function public.count_nearby_offers_since(
  since_ts timestamptz,
  lat double precision,
  lng double precision,
  radius_meters integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      o.id as offer_id,
      b.latitude::double precision as b_lat,
      b.longitude::double precision as b_lng
    from public.offers o
    join public.businesses b on b.id = o.business_id
    where o.approval_status = 'approved'
      and o.active = true
      and coalesce(o.approved_at, o.created_at) >= since_ts
      and b.latitude is not null
      and b.longitude is not null
  ),
  distances as (
    select
      offer_id,
      6371000.0 * 2.0 * asin(
        sqrt(
          power(sin(radians((b_lat - lat) / 2.0)), 2.0) +
          cos(radians(lat)) * cos(radians(b_lat)) *
          power(sin(radians((b_lng - lng) / 2.0)), 2.0)
        )
      ) as meters
    from candidates
  )
  select count(*)::integer
  from distances
  where meters <= greatest(radius_meters, 0);
$$;

