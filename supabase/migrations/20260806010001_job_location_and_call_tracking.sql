-- Store customer call taps and job location checkpoints used by the app.

create table if not exists public.business_call_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  redemption_id uuid references public.redemptions(id) on delete set null,
  phone text,
  called_at timestamptz not null default now(),
  source text not null default 'business_profile',
  created_at timestamptz not null default now()
);

create index if not exists business_call_events_business_called_at_idx
  on public.business_call_events(business_id, called_at desc);

create index if not exists business_call_events_user_called_at_idx
  on public.business_call_events(user_id, called_at desc)
  where user_id is not null;

create index if not exists business_call_events_redemption_idx
  on public.business_call_events(redemption_id)
  where redemption_id is not null;

alter table public.business_call_events enable row level security;

drop policy if exists "Users can create business call events"
  on public.business_call_events;
create policy "Users can create business call events"
on public.business_call_events for insert
to anon, authenticated
with check (
  user_id is null
  or user_id = (select auth.uid())
);

drop policy if exists "Users can read own business call events"
  on public.business_call_events;
create policy "Users can read own business call events"
on public.business_call_events for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Business owners can read business call events"
  on public.business_call_events;
create policy "Business owners can read business call events"
on public.business_call_events for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = business_call_events.business_id
      and b.owner_id = (select auth.uid())
  )
  or public.is_business_member(business_call_events.business_id)
);

drop policy if exists "Staff can read business call events"
  on public.business_call_events;
create policy "Staff can read business call events"
on public.business_call_events for select
to authenticated
using (public.is_staff());

alter table public.redemptions
  add column if not exists checked_in_at timestamptz,
  add column if not exists check_in_latitude double precision,
  add column if not exists check_in_longitude double precision,
  add column if not exists checked_out_at timestamptz,
  add column if not exists check_out_latitude double precision,
  add column if not exists check_out_longitude double precision,
  add column if not exists job_status text;

alter table public.redemptions
  drop constraint if exists redemptions_job_status_check;
alter table public.redemptions
  add constraint redemptions_job_status_check
  check (
    job_status is null
    or job_status in ('active', 'checked_in', 'complete', 'cancelled')
  );

alter table public.redemptions
  drop constraint if exists redemptions_check_in_coordinate_pair_check;
alter table public.redemptions
  add constraint redemptions_check_in_coordinate_pair_check
  check (
    (checked_in_at is null and check_in_latitude is null and check_in_longitude is null)
    or
    (checked_in_at is not null and check_in_latitude is not null and check_in_longitude is not null)
  );

alter table public.redemptions
  drop constraint if exists redemptions_check_out_requires_check_in_check;
alter table public.redemptions
  add constraint redemptions_check_out_requires_check_in_check
  check (
    checked_out_at is null
    or checked_in_at is not null
  );

alter table public.redemptions
  drop constraint if exists redemptions_check_out_coordinate_pair_check;
alter table public.redemptions
  add constraint redemptions_check_out_coordinate_pair_check
  check (
    (checked_out_at is null and check_out_latitude is null and check_out_longitude is null)
    or
    (checked_out_at is not null and check_out_latitude is not null and check_out_longitude is not null)
  );

create index if not exists redemptions_checked_in_at_idx
  on public.redemptions(checked_in_at)
  where checked_in_at is not null;

create index if not exists redemptions_checked_out_at_idx
  on public.redemptions(checked_out_at)
  where checked_out_at is not null;

create index if not exists redemptions_job_status_idx
  on public.redemptions(job_status)
  where job_status is not null;

comment on table public.business_call_events is
  'Customer-initiated call taps from a business profile or related job context.';

comment on column public.redemptions.checked_in_at is
  'Customer GPS check-in timestamp for an active job/redemption.';

comment on column public.redemptions.checked_out_at is
  'Customer GPS checkout timestamp for a completed job/redemption.';
