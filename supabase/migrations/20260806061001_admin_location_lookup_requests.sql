-- One-time admin location lookup requests for active checked-in jobs.
-- This is request/response audit state, not a continuous location history.

create table if not exists public.admin_location_lookup_requests (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.redemptions(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'responded', 'unavailable', 'expired')),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  error_message text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  constraint admin_location_lookup_response_state check (
    (
      status = 'responded'
      and latitude is not null
      and longitude is not null
      and responded_at is not null
    )
    or (
      status <> 'responded'
      and (latitude is null or longitude is null)
    )
  )
);

alter table public.admin_location_lookup_requests enable row level security;

drop policy if exists "Admins can create location lookup requests"
  on public.admin_location_lookup_requests;
create policy "Admins can create location lookup requests"
on public.admin_location_lookup_requests
for insert
with check (
  public.is_admin()
  and requested_by = auth.uid()
  and exists (
    select 1
    from public.redemptions r
    where r.id = admin_location_lookup_requests.redemption_id
      and r.scanned_by = admin_location_lookup_requests.customer_id
      and r.business_id = admin_location_lookup_requests.business_id
      and r.checked_in_at is not null
      and r.checked_out_at is null
  )
);

drop policy if exists "Admins can read location lookup requests"
  on public.admin_location_lookup_requests;
create policy "Admins can read location lookup requests"
on public.admin_location_lookup_requests
for select
using (public.is_admin());

drop policy if exists "Customers can read own active location lookup requests"
  on public.admin_location_lookup_requests;
create policy "Customers can read own active location lookup requests"
on public.admin_location_lookup_requests
for select
using (
  customer_id = auth.uid()
  and status = 'requested'
  and expires_at > now()
);

drop policy if exists "Customers can answer own location lookup requests"
  on public.admin_location_lookup_requests;
create policy "Customers can answer own location lookup requests"
on public.admin_location_lookup_requests
for update
using (
  customer_id = auth.uid()
  and status = 'requested'
  and expires_at > now()
  and exists (
    select 1
    from public.redemptions r
    where r.id = admin_location_lookup_requests.redemption_id
      and r.scanned_by = auth.uid()
      and r.checked_in_at is not null
      and r.checked_out_at is null
  )
)
with check (
  customer_id = auth.uid()
  and status in ('responded', 'unavailable')
  and responded_at is not null
);

drop policy if exists "Admins can expire location lookup requests"
  on public.admin_location_lookup_requests;
create policy "Admins can expire location lookup requests"
on public.admin_location_lookup_requests
for update
using (public.is_admin())
with check (public.is_admin());

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime
      add table public.admin_location_lookup_requests;
  end if;
exception
  when duplicate_object then null;
end $$;
