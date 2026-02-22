-- Prevent duplicate Stripe draft invoice creation/sync races.
-- 1) Skip DB-triggered admin sync for Plaid-auto-verified receipts because
--    plaid-verify-purchase already pushes the commission event to Stripe.
-- 2) Ensure only one active (draft/open) commission invoice exists per
--    business + period in DB.

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

  -- Plaid auto-verification path already syncs directly in edge function.
  -- Skip enqueue here to prevent duplicate invoice attempts for the same event.
  if exists (
    select 1
    from public.receipt_uploads ru
    where ru.redemption_id = new.redemption_id
      and lower(coalesce(ru.verification_source, '')) = 'plaid'
      and ru.review_status = 'verified'
  ) then
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

-- Cleanup existing DB duplicates: keep the most recently updated active
-- invoice row per business+period and mark older duplicates as failed.
with ranked as (
  select
    id,
    row_number() over (
      partition by business_id, period_start, period_end
      order by
        created_at desc,
        id desc
    ) as rn
  from public.commission_invoices
  where status in ('draft', 'open')
    and period_start is not null
    and period_end is not null
)
update public.commission_invoices ci
set status = 'failed'
from ranked r
where ci.id = r.id
  and r.rn > 1;

create unique index if not exists commission_invoices_one_active_period_idx
  on public.commission_invoices (business_id, period_start, period_end)
  where status in ('draft', 'open')
    and period_start is not null
    and period_end is not null;
