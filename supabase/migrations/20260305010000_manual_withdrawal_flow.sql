-- Manual withdrawal flow (Mercury ACH) scaffolding.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists cashout_terms_accepted_at timestamptz;

create table if not exists public.user_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  routing_number text not null,
  account_number text not null,
  bank_name text,
  account_holder_name text not null,
  routing_last4 text,
  account_last4 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_bank_accounts_routing_encrypted_check
    check (routing_number like 'enc::%'),
  constraint user_bank_accounts_account_encrypted_check
    check (account_number like 'enc::%')
);

create index if not exists user_bank_accounts_user_updated_idx
  on public.user_bank_accounts(user_id, updated_at desc);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payout_id uuid references public.cashout_payouts(id) on delete set null,
  amount numeric(10,2) not null,
  routing_number text not null,
  account_number text not null,
  bank_name text,
  account_holder_name text not null,
  routing_last4 text,
  account_last4 text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawal_requests_routing_encrypted_check
    check (routing_number like 'enc::%'),
  constraint withdrawal_requests_account_encrypted_check
    check (account_number like 'enc::%')
);

create index if not exists withdrawal_requests_user_created_idx
  on public.withdrawal_requests(user_id, created_at desc);

create index if not exists withdrawal_requests_status_created_idx
  on public.withdrawal_requests(status, created_at desc);

create unique index if not exists withdrawal_requests_payout_id_uq
  on public.withdrawal_requests(payout_id)
  where payout_id is not null;

create or replace function public.encrypt_bank_value(
  p_plain text,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_plain text := trim(coalesce(p_plain, ''));
  v_key text := trim(coalesce(p_key, ''));
begin
  if v_plain = '' then
    raise exception 'bank value cannot be empty';
  end if;
  if length(v_key) < 16 then
    raise exception 'invalid encryption key';
  end if;
  return 'enc::' || armor(
    pgp_sym_encrypt(
      v_plain,
      v_key,
      'cipher-algo=aes256,compress-algo=1'
    )
  );
end;
$$;

create or replace function public.decrypt_bank_value(
  p_cipher text,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cipher text := trim(coalesce(p_cipher, ''));
  v_key text := trim(coalesce(p_key, ''));
begin
  if v_cipher = '' then
    return null;
  end if;
  if length(v_key) < 16 then
    raise exception 'invalid encryption key';
  end if;
  if v_cipher not like 'enc::%' then
    raise exception 'invalid encrypted payload';
  end if;
  return convert_from(
    pgp_sym_decrypt(
      dearmor(substring(v_cipher from 6)),
      v_key
    ),
    'utf8'
  );
end;
$$;

create or replace function public.upsert_user_bank_account_secure(
  p_user_id uuid,
  p_routing_number text,
  p_account_number text,
  p_bank_name text,
  p_account_holder_name text,
  p_encryption_key text
)
returns table (
  id uuid,
  user_id uuid,
  bank_name text,
  account_holder_name text,
  routing_last4 text,
  account_last4 text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_routing text := regexp_replace(coalesce(p_routing_number, ''), '\D+', '', 'g');
  v_account text := regexp_replace(coalesce(p_account_number, ''), '\D+', '', 'g');
  v_holder text := trim(coalesce(p_account_holder_name, ''));
  v_bank_name text := nullif(trim(coalesce(p_bank_name, '')), '');
  v_row public.user_bank_accounts%rowtype;
begin
  if p_user_id is null then
    raise exception 'missing user id';
  end if;
  if length(v_routing) < 4 or length(v_account) < 4 then
    raise exception 'invalid bank account details';
  end if;
  if v_holder = '' then
    raise exception 'missing account holder name';
  end if;

  insert into public.user_bank_accounts (
    user_id,
    routing_number,
    account_number,
    bank_name,
    account_holder_name,
    routing_last4,
    account_last4
  ) values (
    p_user_id,
    public.encrypt_bank_value(v_routing, p_encryption_key),
    public.encrypt_bank_value(v_account, p_encryption_key),
    v_bank_name,
    v_holder,
    right(v_routing, 4),
    right(v_account, 4)
  )
  on conflict (user_id) do update set
    routing_number = excluded.routing_number,
    account_number = excluded.account_number,
    bank_name = excluded.bank_name,
    account_holder_name = excluded.account_holder_name,
    routing_last4 = excluded.routing_last4,
    account_last4 = excluded.account_last4,
    updated_at = now()
  returning * into v_row;

  return query
  select
    v_row.id,
    v_row.user_id,
    v_row.bank_name,
    v_row.account_holder_name,
    v_row.routing_last4,
    v_row.account_last4,
    v_row.updated_at;
end;
$$;

create or replace function public.get_user_bank_account_secure(
  p_user_id uuid,
  p_encryption_key text
)
returns table (
  id uuid,
  user_id uuid,
  routing_number text,
  account_number text,
  routing_last4 text,
  account_last4 text,
  bank_name text,
  account_holder_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select
    uba.id,
    uba.user_id,
    public.decrypt_bank_value(uba.routing_number, p_encryption_key) as routing_number,
    public.decrypt_bank_value(uba.account_number, p_encryption_key) as account_number,
    uba.routing_last4,
    uba.account_last4,
    uba.bank_name,
    uba.account_holder_name,
    uba.created_at,
    uba.updated_at
  from public.user_bank_accounts uba
  where uba.user_id = p_user_id
  limit 1;
end;
$$;

create or replace function public.create_withdrawal_request_secure(
  p_user_id uuid,
  p_payout_id uuid,
  p_amount numeric,
  p_routing_number text,
  p_account_number text,
  p_bank_name text,
  p_account_holder_name text,
  p_admin_notes text,
  p_encryption_key text
)
returns table (
  id uuid,
  user_id uuid,
  payout_id uuid,
  amount numeric,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_routing text := regexp_replace(coalesce(p_routing_number, ''), '\D+', '', 'g');
  v_account text := regexp_replace(coalesce(p_account_number, ''), '\D+', '', 'g');
  v_holder text := trim(coalesce(p_account_holder_name, ''));
  v_bank_name text := nullif(trim(coalesce(p_bank_name, '')), '');
  v_row public.withdrawal_requests%rowtype;
begin
  if p_user_id is null then
    raise exception 'missing user id';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'invalid withdrawal amount';
  end if;
  if length(v_routing) < 4 or length(v_account) < 4 then
    raise exception 'invalid bank account details';
  end if;
  if v_holder = '' then
    raise exception 'missing account holder name';
  end if;

  insert into public.withdrawal_requests (
    user_id,
    payout_id,
    amount,
    routing_number,
    account_number,
    bank_name,
    account_holder_name,
    routing_last4,
    account_last4,
    status,
    admin_notes
  ) values (
    p_user_id,
    p_payout_id,
    p_amount,
    public.encrypt_bank_value(v_routing, p_encryption_key),
    public.encrypt_bank_value(v_account, p_encryption_key),
    v_bank_name,
    v_holder,
    right(v_routing, 4),
    right(v_account, 4),
    'pending',
    nullif(trim(coalesce(p_admin_notes, '')), '')
  )
  returning * into v_row;

  return query
  select
    v_row.id,
    v_row.user_id,
    v_row.payout_id,
    v_row.amount,
    v_row.status,
    v_row.created_at;
end;
$$;

revoke all on function public.encrypt_bank_value(text, text) from public, anon, authenticated;
revoke all on function public.decrypt_bank_value(text, text) from public, anon, authenticated;
revoke all on function public.upsert_user_bank_account_secure(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_user_bank_account_secure(uuid, text) from public, anon, authenticated;
revoke all on function public.create_withdrawal_request_secure(uuid, uuid, numeric, text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.upsert_user_bank_account_secure(uuid, text, text, text, text, text) to service_role;
grant execute on function public.get_user_bank_account_secure(uuid, text) to service_role;
grant execute on function public.create_withdrawal_request_secure(uuid, uuid, numeric, text, text, text, text, text, text) to service_role;

drop trigger if exists set_user_bank_accounts_updated_at on public.user_bank_accounts;
create trigger set_user_bank_accounts_updated_at
before update on public.user_bank_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_withdrawal_requests_updated_at on public.withdrawal_requests;
create trigger set_withdrawal_requests_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

alter table public.user_bank_accounts enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "Users can view own bank account" on public.user_bank_accounts;
create policy "Users can view own bank account"
  on public.user_bank_accounts for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own bank account" on public.user_bank_accounts;
create policy "Users can insert own bank account"
  on public.user_bank_accounts for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own bank account" on public.user_bank_accounts;
create policy "Users can update own bank account"
  on public.user_bank_accounts for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can view own withdrawal requests" on public.withdrawal_requests;
create policy "Users can view own withdrawal requests"
  on public.withdrawal_requests for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own withdrawal requests" on public.withdrawal_requests;
create policy "Users can insert own withdrawal requests"
  on public.withdrawal_requests for insert
  with check ((select auth.uid()) = user_id);

create or replace function public.apply_withdrawal_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payout_id is null then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status = 'paid' and old.status <> 'paid' then
    update public.cashout_payouts
    set
      status = 'paid',
      processed_at = coalesce(processed_at, now()),
      failure_reason = null,
      updated_at = now()
    where id = new.payout_id;

    update public.cashback_events
    set
      status = 'paid',
      updated_at = now()
    where payout_id = new.payout_id
      and status = 'reserved';

    return new;
  end if;

  if new.status in ('failed', 'cancelled') and old.status not in ('failed', 'cancelled') then
    update public.cashout_payouts
    set
      status = 'failed',
      failure_reason = coalesce(nullif(trim(coalesce(new.admin_notes, '')), ''), failure_reason),
      processed_at = coalesce(processed_at, now()),
      updated_at = now()
    where id = new.payout_id
      and status <> 'paid';

    update public.cashback_events
    set
      status = 'available',
      payout_id = null,
      updated_at = now()
    where payout_id = new.payout_id
      and status = 'reserved';
  end if;

  return new;
end;
$$;

drop trigger if exists on_withdrawal_request_status_change on public.withdrawal_requests;
create trigger on_withdrawal_request_status_change
after update on public.withdrawal_requests
for each row execute function public.apply_withdrawal_request_status_change();

