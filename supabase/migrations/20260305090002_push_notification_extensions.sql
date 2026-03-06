-- Extend push notification kinds for cashback unlock + monthly summary.
-- Safe to run multiple times.

create extension if not exists pg_cron;

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where con.contype = 'c'
      and nsp.nspname = 'public'
      and rel.relname = 'notification_dispatch_state'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format(
      'alter table public.notification_dispatch_state drop constraint %I',
      v_constraint
    );
  end loop;

  for v_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where con.contype = 'c'
      and nsp.nspname = 'public'
      and rel.relname = 'notification_deliveries'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format(
      'alter table public.notification_deliveries drop constraint %I',
      v_constraint
    );
  end loop;
end
$$;

alter table public.notification_dispatch_state
  add constraint notification_dispatch_state_kind_check
  check (
    kind in (
      'new_offer',
      'expiring_offer',
      'nearby_offer',
      'cashback_unlocked',
      'monthly_summary'
    )
  );

alter table public.notification_deliveries
  add constraint notification_deliveries_kind_check
  check (
    kind in (
      'new_offer',
      'expiring_offer',
      'nearby_offer',
      'cashback_unlocked',
      'monthly_summary'
    )
  );

do $$
declare
  v_job_id integer;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'push-cashback-unlocked'
   limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'push-cashback-unlocked',
    '*/15 * * * *',
    $job$
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
          'kinds', jsonb_build_array('cashback_unlocked')
        )
      ) as request_id;
    $job$
  );
end
$$;

do $$
declare
  v_job_id integer;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'push-monthly-summary'
   limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'push-monthly-summary',
    '0 10 1 * *',
    $job$
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
          'kinds', jsonb_build_array('monthly_summary')
        )
      ) as request_id;
    $job$
  );
end
$$;
