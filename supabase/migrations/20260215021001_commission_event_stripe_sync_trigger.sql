-- Ensure manually verified receipts are pushed to Stripe draft invoices.
-- Plaid auto-verification already syncs in-edge; this adds DB-level sync
-- for manual review flows that only update receipt_uploads/commission_events.

create or replace function public.enqueue_commission_event_stripe_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_url text;
  v_anon_key text;
  v_cron_secret text;
begin
  if coalesce(new.status, '') <> 'pending' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.status, '') = 'pending'
     and coalesce(old.amount_cents, 0) = coalesce(new.amount_cents, 0)
     and coalesce(old.business_id::text, '') = coalesce(new.business_id::text, '')
     and coalesce(old.redemption_id::text, '') = coalesce(new.redemption_id::text, '') then
    return new;
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

  -- Reuse existing cron secret used by push dispatch.
  select decrypted_secret
    into v_cron_secret
  from vault.decrypted_secrets
  where name = 'push_cron_secret'
  limit 1;

  if coalesce(v_project_url, '') = ''
     or coalesce(v_anon_key, '') = ''
     or coalesce(v_cron_secret, '') = '' then
    raise warning 'Stripe draft sync skipped for commission event % due to missing vault secrets.', new.id;
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/admin-add-commission-to-stripe',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object(
      'businessId', new.business_id,
      'redemptionId', new.redemption_id,
      'eventDate', coalesce(new.created_at, now())
    )
  );

  return new;
exception
  when others then
    raise warning 'Stripe draft sync enqueue failed for commission event %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_enqueue_commission_event_stripe_sync on public.commission_events;
create trigger trg_enqueue_commission_event_stripe_sync
after insert or update of status, amount_cents, business_id, redemption_id
on public.commission_events
for each row execute function public.enqueue_commission_event_stripe_sync();

-- Backfill: enqueue sync for any existing pending commission events.
do $$
declare
  rec record;
  v_project_url text;
  v_anon_key text;
  v_cron_secret text;
begin
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
    raise warning 'Stripe draft sync backfill skipped due to missing vault secrets.';
    return;
  end if;

  for rec in
    select id, business_id, redemption_id, created_at
    from public.commission_events
    where status = 'pending'
  loop
    begin
      perform net.http_post(
        url := rtrim(v_project_url, '/') || '/functions/v1/admin-add-commission-to-stripe',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_anon_key,
          'x-cron-secret', v_cron_secret
        ),
        body := jsonb_build_object(
          'businessId', rec.business_id,
          'redemptionId', rec.redemption_id,
          'eventDate', coalesce(rec.created_at, now())
        )
      );
    exception
      when others then
        raise warning 'Stripe draft sync backfill enqueue failed for commission event %: %', rec.id, sqlerrm;
    end;
  end loop;
end;
$$;

