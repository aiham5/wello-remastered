-- Fix ambiguous user_id reference in secure manual bank upsert RPC.
-- Safe to run multiple times.

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

  insert into public.user_bank_accounts as uba (
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
  on conflict on constraint user_bank_accounts_user_id_key do update set
    routing_number = excluded.routing_number,
    account_number = excluded.account_number,
    bank_name = excluded.bank_name,
    account_holder_name = excluded.account_holder_name,
    routing_last4 = excluded.routing_last4,
    account_last4 = excluded.account_last4,
    updated_at = now()
  returning uba.* into v_row;

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

