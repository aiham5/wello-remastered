-- Referral program:
-- - Personal referral codes
-- - One claim per referred user
-- - $5 reward for referred user + referrer after first qualifying cashback event
-- - Referrer earnings capped at $500/month (UTC), referred-side reward still applies
-- - Rewards triggered from cashback_events source='receipt' status='available'
--
-- Safe to run multiple times.

-- 1) Cashback events compatibility for referral rewards.
alter table public.cashback_events
  alter column business_id drop not null;

alter table public.cashback_events
  alter column receipt_upload_id drop not null;

alter table public.cashback_events
  alter column redemption_id drop not null;

alter table public.cashback_events
  add column if not exists source text not null default 'receipt';

alter table public.cashback_events
  drop constraint if exists cashback_events_source_check;

alter table public.cashback_events
  add constraint cashback_events_source_check
  check (source in ('receipt', 'adjustment', 'referral'));

alter table public.cashback_events
  add column if not exists referral_id uuid,
  add column if not exists referral_reward_role text;

alter table public.cashback_events
  drop constraint if exists cashback_events_referral_reward_role_check;

alter table public.cashback_events
  add constraint cashback_events_referral_reward_role_check
  check (
    referral_reward_role is null
    or referral_reward_role in ('referrer', 'referred')
  );

alter table public.cashback_events
  drop constraint if exists cashback_events_referral_shape_check;

alter table public.cashback_events
  add constraint cashback_events_referral_shape_check
  check (
    source <> 'referral'
    or (
      referral_id is not null
      and referral_reward_role is not null
      and receipt_upload_id is null
      and redemption_id is null
    )
  );

create unique index if not exists cashback_events_referral_reward_uidx
  on public.cashback_events(referral_id, referral_reward_role, source);

create index if not exists cashback_events_referrer_monthly_cap_idx
  on public.cashback_events(user_id, created_at)
  where source = 'referral'
    and referral_reward_role = 'referrer'
    and status in ('available', 'reserved', 'paid');

-- 2) Referral core tables.
create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users on delete cascade,
  referred_user_id uuid not null unique references auth.users on delete cascade,
  referral_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'rewarded_both', 'rewarded_referred_only_referrer_capped')),
  claimed_at timestamptz not null default now(),
  qualified_cashback_event_id uuid references public.cashback_events(id) on delete set null,
  referred_rewarded_at timestamptz,
  referrer_rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referrals
  add column if not exists referral_code text;

alter table public.referrals
  add column if not exists status text not null default 'pending';

alter table public.referrals
  add column if not exists claimed_at timestamptz not null default now();

alter table public.referrals
  add column if not exists qualified_cashback_event_id uuid references public.cashback_events(id) on delete set null;

alter table public.referrals
  add column if not exists referred_rewarded_at timestamptz,
  add column if not exists referrer_rewarded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.referrals
  drop constraint if exists referrals_status_check;

alter table public.referrals
  add constraint referrals_status_check
  check (status in ('pending', 'rewarded_both', 'rewarded_referred_only_referrer_capped'));

create index if not exists referrals_referrer_status_idx
  on public.referrals(referrer_user_id, status);

create index if not exists referrals_referred_idx
  on public.referrals(referred_user_id);

alter table public.cashback_events
  drop constraint if exists cashback_events_referral_id_fkey;

alter table public.cashback_events
  add constraint cashback_events_referral_id_fkey
  foreign key (referral_id) references public.referrals(id) on delete set null;

-- 3) Updated-at triggers.
drop trigger if exists set_referral_codes_updated_at on public.referral_codes;
create trigger set_referral_codes_updated_at
before update on public.referral_codes
for each row execute function public.set_updated_at();

drop trigger if exists set_referrals_updated_at on public.referrals;
create trigger set_referrals_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

-- 4) RLS for referral tables.
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

drop policy if exists "Users can read own referral code" on public.referral_codes;
drop policy if exists "Staff can read referral codes" on public.referral_codes;
drop policy if exists "Users can read own referrals" on public.referrals;
drop policy if exists "Staff can read referrals" on public.referrals;

create policy "Users can read own referral code"
on public.referral_codes for select
to authenticated
using (auth.uid() = user_id);

create policy "Staff can read referral codes"
on public.referral_codes for select
to authenticated
using (public.is_staff());

create policy "Users can read own referrals"
on public.referrals for select
to authenticated
using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

create policy "Staff can read referrals"
on public.referrals for select
to authenticated
using (public.is_staff());

-- 5) Helper: ensure one referral code per user.
create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_user_id is null then
    return null;
  end if;

  select rc.code
    into v_code
  from public.referral_codes rc
  where rc.user_id = p_user_id;

  if v_code is not null then
    return v_code;
  end if;

  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    begin
      insert into public.referral_codes (user_id, code)
      values (p_user_id, v_code);
      return v_code;
    exception
      when unique_violation then
        select rc.code
          into v_code
        from public.referral_codes rc
        where rc.user_id = p_user_id;
        if v_code is not null then
          return v_code;
        end if;
    end;
  end loop;
end;
$$;

revoke all on function public.ensure_referral_code(uuid) from public;
grant execute on function public.ensure_referral_code(uuid) to authenticated, service_role;

-- 6) Helper: current UTC month earnings for referrer-side referral rewards.
create or replace function public.get_referrer_monthly_referral_earned_cents(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_total integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  v_month_start := (date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC');
  v_month_end := ((date_trunc('month', p_now at time zone 'UTC') + interval '1 month') at time zone 'UTC');

  select coalesce(sum(ce.amount_cents), 0)::integer
    into v_total
  from public.cashback_events ce
  where ce.user_id = p_user_id
    and ce.source = 'referral'
    and ce.referral_reward_role = 'referrer'
    and ce.status in ('available', 'reserved', 'paid')
    and ce.created_at >= v_month_start
    and ce.created_at < v_month_end;

  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.get_referrer_monthly_referral_earned_cents(uuid, timestamptz) from public;
grant execute on function public.get_referrer_monthly_referral_earned_cents(uuid, timestamptz) to authenticated, service_role;

-- 7) Process referral rewards from first qualifying cashback event.
create or replace function public.process_referral_reward_for_cashback_event(
  p_cashback_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_event record;
  v_referral record;
  v_referred_reward_event_id uuid;
  v_referrer_reward_event_id uuid;
  v_reward_cents integer := 500;
  v_referrer_monthly_earned integer := 0;
  v_referrer_monthly_cap integer := 50000;
begin
  if p_cashback_event_id is null then
    return;
  end if;

  select ce.id, ce.user_id, ce.business_id, ce.source, ce.status
    into v_event
  from public.cashback_events ce
  where ce.id = p_cashback_event_id;

  if not found then
    return;
  end if;

  if coalesce(v_event.source, 'receipt') <> 'receipt' then
    return;
  end if;

  if coalesce(v_event.status, '') <> 'available' then
    return;
  end if;

  select r.*
    into v_referral
  from public.referrals r
  where r.referred_user_id = v_event.user_id
  limit 1
  for update;

  if not found then
    return;
  end if;

  if v_referral.status is distinct from 'pending' then
    return;
  end if;

  insert into public.cashback_events (
    receipt_upload_id,
    redemption_id,
    business_id,
    user_id,
    amount_cents,
    status,
    source,
    referral_id,
    referral_reward_role
  )
  values (
    null,
    null,
    v_event.business_id,
    v_referral.referred_user_id,
    v_reward_cents,
    'available',
    'referral',
    v_referral.id,
    'referred'
  )
  on conflict (referral_id, referral_reward_role, source)
  do nothing
  returning id into v_referred_reward_event_id;

  if v_referred_reward_event_id is null then
    select ce.id
      into v_referred_reward_event_id
    from public.cashback_events ce
    where ce.referral_id = v_referral.id
      and ce.referral_reward_role = 'referred'
      and ce.source = 'referral'
    limit 1;
  end if;

  v_referrer_monthly_earned := public.get_referrer_monthly_referral_earned_cents(
    v_referral.referrer_user_id,
    v_now
  );

  if v_referrer_monthly_earned + v_reward_cents <= v_referrer_monthly_cap then
    insert into public.cashback_events (
      receipt_upload_id,
      redemption_id,
      business_id,
      user_id,
      amount_cents,
      status,
      source,
      referral_id,
      referral_reward_role
    )
    values (
      null,
      null,
      v_event.business_id,
      v_referral.referrer_user_id,
      v_reward_cents,
      'available',
      'referral',
      v_referral.id,
      'referrer'
    )
    on conflict (referral_id, referral_reward_role, source)
    do nothing
    returning id into v_referrer_reward_event_id;

    if v_referrer_reward_event_id is null then
      select ce.id
        into v_referrer_reward_event_id
      from public.cashback_events ce
      where ce.referral_id = v_referral.id
        and ce.referral_reward_role = 'referrer'
        and ce.source = 'referral'
      limit 1;
    end if;
  end if;

  update public.referrals
  set status = case
        when v_referrer_reward_event_id is not null
          then 'rewarded_both'
        else 'rewarded_referred_only_referrer_capped'
      end,
      qualified_cashback_event_id = coalesce(qualified_cashback_event_id, v_event.id),
      referred_rewarded_at = coalesce(referred_rewarded_at, v_now),
      referrer_rewarded_at = case
        when v_referrer_reward_event_id is not null
          then coalesce(referrer_rewarded_at, v_now)
        else referrer_rewarded_at
      end,
      updated_at = v_now
  where id = v_referral.id;
end;
$$;

-- 8) Trigger cashback event processing for referral rewards.
create or replace function public.cashback_events_process_referral_rewards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'receipt' and new.status = 'available' then
    if tg_op = 'INSERT' then
      perform public.process_referral_reward_for_cashback_event(new.id);
    elsif tg_op = 'UPDATE'
      and (
        old.status is distinct from new.status
        or old.source is distinct from new.source
      ) then
      perform public.process_referral_reward_for_cashback_event(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cashback_events_process_referral_rewards on public.cashback_events;
create trigger cashback_events_process_referral_rewards
after insert or update on public.cashback_events
for each row execute function public.cashback_events_process_referral_rewards();
