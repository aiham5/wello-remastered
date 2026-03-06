-- Chargeback fraud protection + first redemption bonus + receipt hash dedup.
-- Safe to run multiple times.

create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_logs enable row level security;
revoke all on table public.system_logs from anon, authenticated;

alter table public.purchase_verifications
  add column if not exists chargeback_flagged boolean not null default false,
  add column if not exists chargeback_flagged_at timestamptz;

create index if not exists purchase_verifications_chargeback_flagged_idx
  on public.purchase_verifications(chargeback_flagged, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'purchase_verifications'
      and indexdef ilike '%(matched_plaid_transaction_id)%'
      and indexdef ilike '%where matched_plaid_transaction_id is not null%'
  ) then
    execute '
      create index idx_pv_matched_plaid_transaction_id
        on public.purchase_verifications(matched_plaid_transaction_id)
        where matched_plaid_transaction_id is not null
    ';
  end if;
end $$;

alter table public.profiles
  add column if not exists fraud_score integer not null default 0,
  add column if not exists fraud_flagged boolean not null default false,
  add column if not exists first_redemption_bonus_paid boolean not null default false;

create index if not exists profiles_fraud_flagged_idx
  on public.profiles(fraud_flagged, fraud_score desc);

alter table public.redemptions
  add column if not exists cashback_status text not null default 'pending';

alter table public.redemptions
  drop constraint if exists redemptions_cashback_status_check;

alter table public.redemptions
  add constraint redemptions_cashback_status_check
  check (cashback_status in ('pending', 'available', 'withdrawn', 'frozen'));

update public.redemptions r
set cashback_status = 'withdrawn'
where exists (
  select 1
  from public.cashback_events ce
  where ce.redemption_id = r.id
    and ce.status = 'paid'
);

update public.redemptions r
set cashback_status = 'available'
where r.cashback_status = 'pending'
  and exists (
    select 1
    from public.cashback_events ce
    where ce.redemption_id = r.id
      and ce.status in ('available', 'reserved')
  );

create index if not exists redemptions_scanned_cashback_status_idx
  on public.redemptions(scanned_by, cashback_status, created_at desc);

alter table public.receipt_uploads
  add column if not exists image_hash text;

create unique index if not exists idx_unique_receipt_image_hash
  on public.receipt_uploads(image_hash)
  where image_hash is not null;

create or replace function public.increment_fraud_score(
  p_user_id uuid,
  p_increment integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_increment integer := greatest(coalesce(p_increment, 0), 0);
  v_new_score integer := 0;
begin
  if p_user_id is null or v_increment <= 0 then
    return;
  end if;

  insert into public.profiles (id, fraud_score, fraud_flagged, first_redemption_bonus_paid)
  values (p_user_id, v_increment, v_increment >= 30, false)
  on conflict (id) do update
    set fraud_score = coalesce(profiles.fraud_score, 0) + v_increment,
        fraud_flagged = coalesce(profiles.fraud_flagged, false)
          or (coalesce(profiles.fraud_score, 0) + v_increment) >= 30,
        updated_at = now()
  returning fraud_score into v_new_score;

  insert into public.system_logs (event_type, details)
  values (
    'fraud_score_updated',
    jsonb_build_object(
      'user_id', p_user_id,
      'increment', v_increment,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'new_score', v_new_score,
      'timestamp', now()
    )
  );
end;
$$;

create or replace function public.add_cashback_bonus(
  p_user_id uuid,
  p_amount numeric,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount_cents integer := floor(coalesce(p_amount, 0) * 100);
  v_reason text := trim(coalesce(p_reason, 'bonus'));
  v_event_id uuid := null;
begin
  if p_user_id is null or v_amount_cents <= 0 then
    return false;
  end if;

  insert into public.profiles (id, first_redemption_bonus_paid)
  values (p_user_id, false)
  on conflict (id) do nothing;

  if v_reason = 'first_redemption_bonus' then
    update public.profiles
    set first_redemption_bonus_paid = true,
        updated_at = now()
    where id = p_user_id
      and coalesce(first_redemption_bonus_paid, false) = false;

    if not found then
      return false;
    end if;
  end if;

  insert into public.cashback_events (
    receipt_upload_id,
    redemption_id,
    business_id,
    user_id,
    amount_cents,
    status,
    source,
    payout_id
  ) values (
    null,
    null,
    null,
    p_user_id,
    v_amount_cents,
    'available',
    'adjustment',
    null
  )
  returning id into v_event_id;

  insert into public.system_logs (event_type, details)
  values (
    'cashback_bonus_paid',
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_cents', v_amount_cents,
      'reason', v_reason,
      'cashback_event_id', v_event_id,
      'timestamp', now()
    )
  );

  return true;
end;
$$;

create or replace function public.receipt_uploads_detect_duplicate_image_hash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid := null;
  v_existing_user_id uuid := null;
begin
  new.image_hash := lower(trim(coalesce(new.image_hash, '')));
  if new.image_hash = '' then
    new.image_hash := null;
    return new;
  end if;

  select ru.id, ru.user_id
    into v_existing_id, v_existing_user_id
    from public.receipt_uploads ru
   where ru.image_hash = new.image_hash
     and (tg_op = 'INSERT' or ru.id <> new.id)
   order by ru.created_at asc
   limit 1;

  if v_existing_id is not null then
    perform public.increment_fraud_score(
      new.user_id,
      25,
      'duplicate_receipt_submission'
    );

    insert into public.system_logs (event_type, details)
    values (
      'duplicate_receipt_rejected',
      jsonb_build_object(
        'submitting_user_id', new.user_id,
        'original_upload_id', v_existing_id,
        'original_user_id', v_existing_user_id,
        'image_hash', new.image_hash,
        'timestamp', now()
      )
    );

    raise exception using
      message = 'DUPLICATE_RECEIPT',
      errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists receipt_uploads_detect_duplicate_image_hash on public.receipt_uploads;
create trigger receipt_uploads_detect_duplicate_image_hash
before insert or update of image_hash on public.receipt_uploads
for each row execute function public.receipt_uploads_detect_duplicate_image_hash();

revoke all on function public.increment_fraud_score(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.add_cashback_bonus(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.increment_fraud_score(uuid, integer, text) to service_role;
grant execute on function public.add_cashback_bonus(uuid, numeric, text) to service_role;
