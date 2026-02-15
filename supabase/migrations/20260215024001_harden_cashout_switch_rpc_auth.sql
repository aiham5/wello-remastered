-- Harden cashout bank-switch RPCs so callers cannot supply another user's ID.
-- Keep service_role access for server-side edge function calls.

create or replace function public.get_cashout_bank_switch_policy(
  p_user_id uuid,
  p_monthly_limit integer default 2
)
returns table (
  monthly_limit integer,
  switches_used integer,
  switches_remaining integer,
  month_starts_at timestamptz,
  month_resets_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_monthly_limit, 2), 1);
  v_month_start timestamptz := date_trunc('month', now());
  v_next_month timestamptz := v_month_start + interval '1 month';
  v_used integer := 0;
  v_auth_uid uuid := auth.uid();
  v_claim_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- For non-service callers, enforce strict self-access.
  if v_claim_role <> 'service_role' then
    if v_auth_uid is null then
      raise exception 'authentication required';
    end if;
    if p_user_id is distinct from v_auth_uid then
      raise exception 'p_user_id must match auth.uid()';
    end if;
  end if;

  select count(*)
    into v_used
    from public.cashout_bank_switch_events e
    where e.user_id = p_user_id
      and e.created_at >= v_month_start
      and e.created_at < v_next_month;

  return query select
    v_limit,
    v_used,
    greatest(v_limit - v_used, 0),
    v_month_start,
    v_next_month;
end;
$$;

create or replace function public.consume_cashout_bank_switch(
  p_user_id uuid,
  p_from_plaid_account_id text,
  p_to_plaid_account_id text,
  p_monthly_limit integer default 2
)
returns table (
  allowed boolean,
  reason_code text,
  event_id uuid,
  monthly_limit integer,
  switches_used integer,
  switches_remaining integer,
  month_resets_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_monthly_limit, 2), 1);
  v_from text := nullif(trim(coalesce(p_from_plaid_account_id, '')), '');
  v_to text := nullif(trim(coalesce(p_to_plaid_account_id, '')), '');
  v_month_start timestamptz := date_trunc('month', now());
  v_next_month timestamptz := v_month_start + interval '1 month';
  v_used integer := 0;
  v_event_id uuid := null;
  v_auth_uid uuid := auth.uid();
  v_claim_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- For non-service callers, enforce strict self-access.
  if v_claim_role <> 'service_role' then
    if v_auth_uid is null then
      raise exception 'authentication required';
    end if;
    if p_user_id is distinct from v_auth_uid then
      raise exception 'p_user_id must match auth.uid()';
    end if;
  end if;

  if v_to is null then
    raise exception 'p_to_plaid_account_id is required';
  end if;

  -- Serialize switch decisions per user.
  perform 1
    from public.profiles p
    where p.id = p_user_id
    for update;

  select count(*)
    into v_used
    from public.cashout_bank_switch_events e
    where e.user_id = p_user_id
      and e.created_at >= v_month_start
      and e.created_at < v_next_month;

  if v_from is null then
    return query select
      true,
      'initial_selection',
      null::uuid,
      v_limit,
      v_used,
      greatest(v_limit - v_used, 0),
      v_next_month;
    return;
  end if;

  if v_from = v_to then
    return query select
      true,
      'unchanged',
      null::uuid,
      v_limit,
      v_used,
      greatest(v_limit - v_used, 0),
      v_next_month;
    return;
  end if;

  if v_used >= v_limit then
    return query select
      false,
      'switch_limit_reached',
      null::uuid,
      v_limit,
      v_used,
      0,
      v_next_month;
    return;
  end if;

  insert into public.cashout_bank_switch_events (
    user_id,
    from_plaid_account_id,
    to_plaid_account_id
  )
  values (
    p_user_id,
    v_from,
    v_to
  )
  returning id into v_event_id;

  v_used := v_used + 1;

  return query select
    true,
    'switch_recorded',
    v_event_id,
    v_limit,
    v_used,
    greatest(v_limit - v_used, 0),
    v_next_month;
end;
$$;

revoke execute on function public.get_cashout_bank_switch_policy(uuid, integer)
  from public, authenticated;
revoke execute on function public.consume_cashout_bank_switch(uuid, text, text, integer)
  from public, authenticated;

grant execute on function public.get_cashout_bank_switch_policy(uuid, integer)
  to service_role;
grant execute on function public.consume_cashout_bank_switch(uuid, text, text, integer)
  to service_role;
