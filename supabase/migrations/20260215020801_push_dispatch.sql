-- Push notification dispatch support tables and helpers.
-- Used by `supabase/functions/push-dispatch`.

create table if not exists public.notification_dispatch_state (
  kind text primary key
    check (kind in ('new_offer', 'expiring_offer', 'nearby_offer')),
  last_run_at timestamptz
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('new_offer', 'expiring_offer', 'nearby_offer')),
  sent_count integer not null default 0,
  error_count integer not null default 0,
  since_at timestamptz not null,
  ran_at timestamptz not null,
  dry_run boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notification_deliveries_kind_ran_at_idx
  on public.notification_deliveries(kind, ran_at desc);

alter table public.notification_dispatch_state enable row level security;
alter table public.notification_deliveries enable row level security;

-- Staff-only visibility; service-role bypasses RLS regardless.
drop policy if exists "Staff can read notification deliveries" on public.notification_deliveries;
create policy "Staff can read notification deliveries"
  on public.notification_deliveries
  for select
  using (public.is_staff());

drop policy if exists "Staff can read notification dispatch state" on public.notification_dispatch_state;
create policy "Staff can read notification dispatch state"
  on public.notification_dispatch_state
  for select
  using (public.is_staff());

-- Nearby offers count helper (Haversine).
-- Depends on:
-- - public.offers(created_at, business_id, approval_status, active)
-- - public.businesses(latitude, longitude)
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
      and o.created_at >= since_ts
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

