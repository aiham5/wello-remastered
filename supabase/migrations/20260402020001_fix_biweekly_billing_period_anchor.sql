-- Make the bi-weekly billing cron compute explicit anchored periods.
-- This avoids day-boundary skips and keeps the edge function aligned with the
-- intended 14-day billing windows.

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
  v_candidate_end_date date := timezone('UTC', now())::date;
  v_period_start date;
  v_day_delta integer;
begin
  v_day_delta := v_candidate_end_date - v_anchor_end_date;

  if mod(v_day_delta, 14) <> 0 then
    return false;
  end if;

  v_period_start := v_candidate_end_date - 14;

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
    body := jsonb_build_object(
      'periodStart', (v_period_start::text || 'T00:00:00.000Z'),
      'periodEnd', (v_candidate_end_date::text || 'T00:00:00.000Z')
    )
  );

  return true;
exception
  when others then
    raise warning 'Bi-weekly billing trigger failed: %', sqlerrm;
    return false;
end;
$$;
