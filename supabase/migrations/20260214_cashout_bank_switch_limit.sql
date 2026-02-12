-- Cashout payout-bank switch guardrails.
-- Safe to run multiple times.
--
-- Goal:
-- - Keep one active payout destination at a time (already true in profiles),
-- - but cap how often users can switch payout banks per month.
-- - Preserve an audit trail of switches.

create table if not exists public.cashout_bank_switch_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  from_plaid_account_id text not null,
  to_plaid_account_id text not null,
  created_at timestamptz not null default now(),
  check (length(trim(from_plaid_account_id)) > 0),
  check (length(trim(to_plaid_account_id)) > 0),
  check (from_plaid_account_id <> to_plaid_account_id)
);

create index if not exists cashout_bank_switch_events_user_created_idx
  on public.cashout_bank_switch_events(user_id, created_at desc);

alter table public.cashout_bank_switch_events enable row level security;

drop policy if exists "Users can read own cashout bank switch events"
  on public.cashout_bank_switch_events;
drop policy if exists "Staff can read cashout bank switch events"
  on public.cashout_bank_switch_events;

create policy "Users can read own cashout bank switch events"
on public.cashout_bank_switch_events for select
using (auth.uid() = user_id);

create policy "Staff can read cashout bank switch events"
on public.cashout_bank_switch_events for select
using (public.is_staff());

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
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
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
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
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

grant execute on function public.get_cashout_bank_switch_policy(uuid, integer)
  to authenticated, service_role;
grant execute on function public.consume_cashout_bank_switch(uuid, text, text, integer)
  to authenticated, service_role;
