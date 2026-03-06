-- Offer lifecycle + payment protection gap fill.
-- Safe to run multiple times.

alter table public.offers
  add column if not exists expires_at timestamptz,
  add column if not exists status text not null default 'active';

alter table public.offers
  drop constraint if exists offers_status_check;

alter table public.offers
  add constraint offers_status_check
  check (status in ('active', 'inactive', 'paused', 'expired'));

comment on column public.offers.status is 'active | inactive | paused | expired';

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_logs enable row level security;
revoke all on table public.system_logs from anon, authenticated;

create table if not exists public.business_payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  stripe_customer_id text,
  stripe_invoice_id text,
  event_type text not null,
  amount numeric(10, 2),
  status text,
  created_at timestamptz not null default now()
);

alter table public.business_payment_events enable row level security;
revoke all on table public.business_payment_events from anon, authenticated;

create extension if not exists pg_cron;

do $$
declare
  v_existing_job_id integer;
begin
  select jobid
    into v_existing_job_id
  from cron.job
  where jobname = 'expire-offers'
  limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'expire-offers',
    '0 * * * *',
    $job$
      with expired as (
        update public.offers
        set status = 'expired',
            updated_at = now()
        where expires_at < now()
          and status = 'active'
        returning id
      )
      insert into public.system_logs (event_type, details)
      select
        'offers_expired',
        jsonb_build_object('count', count(*))
      from expired;
    $job$
  );
end $$;
