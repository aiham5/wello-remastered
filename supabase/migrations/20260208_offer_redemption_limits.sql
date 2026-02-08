-- Offer redemption limits (per user, per offer).
-- Limits are enforced server-side via a trigger on `redemptions`.

alter table if exists public.offers
  add column if not exists redemption_limit_period text,
  add column if not exists redemption_limit_count integer;

-- `null` = unlimited.
alter table if exists public.offers
  drop constraint if exists offers_redemption_limit_period_chk;
alter table if exists public.offers
  add constraint offers_redemption_limit_period_chk
    check (redemption_limit_period is null or redemption_limit_period in ('day', 'week'));

alter table if exists public.offers
  drop constraint if exists offers_redemption_limit_count_chk;
alter table if exists public.offers
  add constraint offers_redemption_limit_count_chk
    check (redemption_limit_count is null or redemption_limit_count > 0);

create or replace function public.enforce_offer_redemption_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  lim_period text;
  lim_count integer;
  window_interval interval;
  window_start timestamptz;
  existing_count integer;
  oldest_in_window timestamptz;
  next_allowed_at timestamptz;
begin
  if new.offer_id is null then
    return new;
  end if;

  -- We enforce per-user redemptions, so this must be present.
  if new.scanned_by is null then
    raise exception using
      errcode = 'P0001',
      message = 'Missing redemption user';
  end if;

  select
    o.redemption_limit_period,
    o.redemption_limit_count
  into
    lim_period,
    lim_count
  from public.offers o
  where o.id = new.offer_id;

  if lim_period is null or lim_count is null then
    return new; -- unlimited
  end if;

  if lim_period = 'day' then
    window_interval := interval '1 day';
  elsif lim_period = 'week' then
    window_interval := interval '7 days';
  else
    return new; -- unknown period treated as unlimited
  end if;

  window_start := now() - window_interval;

  select count(*)
  into existing_count
  from public.redemptions r
  where r.offer_id = new.offer_id
    and r.scanned_by = new.scanned_by
    and r.created_at >= window_start;

  if existing_count >= lim_count then
    select min(r.created_at)
    into oldest_in_window
    from public.redemptions r
    where r.offer_id = new.offer_id
      and r.scanned_by = new.scanned_by
      and r.created_at >= window_start;

    next_allowed_at := coalesce(oldest_in_window, now()) + window_interval;

    raise exception using
      errcode = 'P0001',
      message = 'Redemption limit reached',
      detail = json_build_object(
        'code', 'REDEEM_LIMIT',
        'period', lim_period,
        'count', lim_count,
        'next_allowed_at', next_allowed_at
      )::text;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_offer_redemption_limit_before_insert on public.redemptions;
create trigger enforce_offer_redemption_limit_before_insert
before insert on public.redemptions
for each row
execute function public.enforce_offer_redemption_limit();

