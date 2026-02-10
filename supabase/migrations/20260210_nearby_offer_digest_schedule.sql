-- Nearby offer digest helper + randomized daily scheduling (2 pushes/day, 5 hours apart).
--
-- Requires:
-- - pg_cron (already enabled in this project)
-- - pg_net (net.http_post)
-- - Vault secrets:
--   - project_url
--   - anon_key
--   - push_cron_secret
--
-- This sets up:
-- - public.get_nearby_offer_digest(...) RPC: returns {count, offer_title, business_name}
-- - public.schedule_nearby_offer_pushes(): re-schedules 2 daily "nearby_offer" digest pushes at random times
-- - cron job "push-nearby-rescheduler": runs daily at 00:05 UTC to randomize the 2 daily times

create or replace function public.get_nearby_offer_digest(
  lat double precision,
  lng double precision,
  radius_meters integer
)
returns table (
  offer_count integer,
  offer_id uuid,
  offer_title text,
  business_id uuid,
  business_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      o.id as offer_id,
      o.title as offer_title,
      b.id as business_id,
      b.name as business_name,
      b.latitude::double precision as b_lat,
      b.longitude::double precision as b_lng,
      coalesce(o.approved_at, o.created_at) as sort_ts
    from public.offers o
    join public.businesses b on b.id = o.business_id
    where o.approval_status = 'approved'
      and o.active = true
      and b.latitude is not null
      and b.longitude is not null
  ),
  distances as (
    select
      offer_id,
      offer_title,
      business_id,
      business_name,
      sort_ts,
      6371000.0 * 2.0 * asin(
        sqrt(
          power(sin(radians((b_lat - lat) / 2.0)), 2.0) +
          cos(radians(lat)) * cos(radians(b_lat)) *
          power(sin(radians((b_lng - lng) / 2.0)), 2.0)
        )
      ) as meters
    from candidates
  ),
  nearby as (
    select *
    from distances
    where meters <= greatest(radius_meters, 0)
  ),
  picked as (
    select *
    from nearby
    order by sort_ts desc, meters asc
    limit 1
  )
  select
    (select count(*)::integer from nearby) as offer_count,
    p.offer_id,
    p.offer_title,
    p.business_id,
    p.business_name
  from picked p;
$$;

create or replace function public.schedule_nearby_offer_pushes()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  minute_1 int;
  hour_1 int;
  hour_2 int;
  jid int;
begin
  -- Pick a random first time in a safe window so +5 hours stays same day (UTC).
  -- 12:00-16:59 UTC, then second is +5h (17:00-21:59 UTC).
  minute_1 := floor(random() * 60)::int;
  hour_1 := 12 + floor(random() * 5)::int; -- 12..16
  hour_2 := hour_1 + 5;

  -- Remove previous daily jobs if present.
  for jid in
    select jobid
    from cron.job
    where jobname in ('push-nearby-digest-1', 'push-nearby-digest-2')
  loop
    perform cron.unschedule(jid);
  end loop;

  -- Schedule two daily digest pushes at randomized times.
  perform cron.schedule(
    'push-nearby-digest-1',
    minute_1::text || ' ' || hour_1::text || ' * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
              || '/functions/v1/push-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
        ),
        body := jsonb_build_object(
          'kinds', jsonb_build_array('nearby_offer'),
          'nearbyMode', 'digest'
        )
      ) as request_id;
    $$
  );

  perform cron.schedule(
    'push-nearby-digest-2',
    minute_1::text || ' ' || hour_2::text || ' * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
              || '/functions/v1/push-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
        ),
        body := jsonb_build_object(
          'kinds', jsonb_build_array('nearby_offer'),
          'nearbyMode', 'digest'
        )
      ) as request_id;
    $$
  );
end;
$fn$;

do $$
declare
  jid int;
begin
  -- Ensure the daily rescheduler exists (00:05 UTC).
  select jobid into jid
  from cron.job
  where jobname = 'push-nearby-rescheduler'
  limit 1;

  if jid is null then
    perform cron.schedule(
      'push-nearby-rescheduler',
      '5 0 * * *',
      $job$ select public.schedule_nearby_offer_pushes(); $job$
    );
  end if;
end $$;

-- Run once immediately so you don't have to wait until 00:05 UTC.
select public.schedule_nearby_offer_pushes();
