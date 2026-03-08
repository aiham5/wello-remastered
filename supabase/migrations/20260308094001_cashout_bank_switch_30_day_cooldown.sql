-- Replace the calendar-month payout bank switch cap with a rolling 30-day cooldown.

create or replace function public.get_cashout_bank_switch_policy(
  p_user_id uuid,
  p_monthly_limit integer default 1
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
  v_limit integer := greatest(coalesce(p_monthly_limit, 1), 1);
  v_window interval := interval '30 days';
  v_window_start timestamptz := now() - v_window;
  v_used integer := 0;
  v_next_allowed_at timestamptz := null;
  v_auth_uid uuid := auth.uid();
  v_claim_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

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
      and e.created_at >= v_window_start;

  select min(e.created_at + v_window)
    into v_next_allowed_at
    from public.cashout_bank_switch_events e
    where e.user_id = p_user_id
      and e.created_at >= v_window_start;

  return query select
    v_limit,
    v_used,
    greatest(v_limit - v_used, 0),
    greatest(now(), v_window_start),
    v_next_allowed_at;
end;
$$;

create or replace function public.consume_cashout_bank_switch(
  p_user_id uuid,
  p_from_plaid_account_id text,
  p_to_plaid_account_id text,
  p_monthly_limit integer default 1
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
  v_limit integer := greatest(coalesce(p_monthly_limit, 1), 1);
  v_from text := nullif(trim(coalesce(p_from_plaid_account_id, '')), '');
  v_to text := nullif(trim(coalesce(p_to_plaid_account_id, '')), '');
  v_window interval := interval '30 days';
  v_window_start timestamptz := now() - v_window;
  v_used integer := 0;
  v_event_id uuid := null;
  v_next_allowed_at timestamptz := null;
  v_auth_uid uuid := auth.uid();
  v_claim_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

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

  perform 1
    from public.profiles p
    where p.id = p_user_id
    for update;

  select count(*)
    into v_used
    from public.cashout_bank_switch_events e
    where e.user_id = p_user_id
      and e.created_at >= v_window_start;

  select min(e.created_at + v_window)
    into v_next_allowed_at
    from public.cashout_bank_switch_events e
    where e.user_id = p_user_id
      and e.created_at >= v_window_start;

  if v_from is null then
    return query select
      true,
      'initial_selection',
      null::uuid,
      v_limit,
      v_used,
      greatest(v_limit - v_used, 0),
      v_next_allowed_at;
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
      v_next_allowed_at;
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
      v_next_allowed_at;
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
  v_next_allowed_at := now() + v_window;

  return query select
    true,
    'switch_recorded',
    v_event_id,
    v_limit,
    v_used,
    greatest(v_limit - v_used, 0),
    v_next_allowed_at;
end;
$$;

