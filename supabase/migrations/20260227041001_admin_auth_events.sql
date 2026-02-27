-- Admin API access/auth diagnostic events (service-role writes, staff reads).

create table if not exists public.admin_auth_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null default 'api_request',
  endpoint text not null default '',
  actor_email text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  outcome text not null check (outcome in ('success', 'failure')),
  reason text,
  status_code integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_auth_events_created_idx
  on public.admin_auth_events(created_at desc);

create index if not exists admin_auth_events_actor_email_idx
  on public.admin_auth_events(actor_email, created_at desc);

create index if not exists admin_auth_events_endpoint_idx
  on public.admin_auth_events(endpoint, created_at desc);

alter table public.admin_auth_events enable row level security;

revoke all on public.admin_auth_events from anon;
revoke all on public.admin_auth_events from authenticated;
grant select on public.admin_auth_events to authenticated;
grant all on public.admin_auth_events to service_role;

drop policy if exists "Staff can read admin auth events" on public.admin_auth_events;
create policy "Staff can read admin auth events"
on public.admin_auth_events
for select
to authenticated
using ((select public.is_staff()));

