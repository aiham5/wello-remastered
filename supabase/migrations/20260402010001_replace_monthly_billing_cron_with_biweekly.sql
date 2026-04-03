-- Replace the legacy monthly billing cron with an anchored bi-weekly trigger.
-- Also keep the cron secrets aligned with the existing working push jobs.

create extension if not exists pg_cron;

create or replace function public.trigger_biweekly_commission_billing()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_url text;
  v_anon_key text;
  v_cron_secret text;
  v_anchor_end_date constant date := date '2026-04-03';
  v_candidate_end_date date := (timezone('UTC', now())::date + 1);
  v_day_delta integer;
begin
  v_day_delta := v_candidate_end_date - v_anchor_end_date;

  if mod(v_day_delta, 14) <> 0 then
    return false;
  end if;

  select decrypted_secret
    into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret
    into v_anon_key
  from vault.decrypted_secrets
  where name = 'anon_key'
  limit 1;

  select decrypted_secret
    into v_cron_secret
  from vault.decrypted_secrets
  where name = 'push_cron_secret'
  limit 1;

  if coalesce(v_project_url, '') = ''
     or coalesce(v_anon_key, '') = ''
     or coalesce(v_cron_secret, '') = '' then
    raise warning 'Bi-weekly billing trigger skipped due to missing vault secrets.';
    return false;
  end if;

  perform net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/stripe-create-monthly-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-cron-secret', v_cron_secret
    ),
    body := '{}'::jsonb
  );

  return true;
exception
  when others then
    raise warning 'Bi-weekly billing trigger failed: %', sqlerrm;
    return false;
end;
$$;

do $$
declare
  jid integer;
begin
  for jid in
    select jobid
    from cron.job
    where jobname in ('charge-monthly-invoices', 'charge-biweekly-invoices')
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'charge-biweekly-invoices',
    '55 23 * * *',
    $job$ select public.trigger_biweekly_commission_billing(); $job$
  );
end
$$;
