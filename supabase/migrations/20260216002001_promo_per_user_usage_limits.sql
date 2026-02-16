-- Add per-user promo usage limits and enforce them when assigning promo_code_id
-- to new receipt uploads.

alter table public.promo_codes
  add column if not exists max_uses_per_user integer null;

alter table public.promo_codes
  drop constraint if exists promo_codes_max_uses_per_user_check;

alter table public.promo_codes
  add constraint promo_codes_max_uses_per_user_check
  check (max_uses_per_user is null or max_uses_per_user > 0);

create index if not exists cashback_events_user_promo_status_idx
  on public.cashback_events(user_id, promo_code_id, status)
  where promo_code_id is not null;

create or replace function public.receipt_uploads_set_promo_code_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_promo_id uuid := null;
  at_time timestamptz := null;
  promo_max_uses integer := null;
  promo_usage_count integer := 0;
begin
  if new.user_id is null then
    new.promo_code_id := null;
    return new;
  end if;

  at_time := coalesce(new.uploaded_at, now());

  select p.promo_code_id
    into profile_promo_id
    from public.profiles p
    where p.id = new.user_id;

  -- Default: no promo.
  new.promo_code_id := null;

  if profile_promo_id is null then
    return new;
  end if;

  -- Promo must be active and within its date window at upload time.
  select pc.max_uses_per_user
    into promo_max_uses
    from public.promo_codes pc
    where pc.id = profile_promo_id
      and pc.active = true
      and (pc.starts_at is null or pc.starts_at <= at_time)
      and (pc.ends_at is null or pc.ends_at >= at_time)
    limit 1;

  -- Not active / not found.
  if not found then
    return new;
  end if;

  -- Unlimited per-user uses.
  if promo_max_uses is null or promo_max_uses <= 0 then
    new.promo_code_id := profile_promo_id;
    return new;
  end if;

  -- Count prior uses for this user + promo. Reversed rows are not counted.
  select count(*)::integer
    into promo_usage_count
    from public.cashback_events ce
    where ce.user_id = new.user_id
      and ce.promo_code_id = profile_promo_id
      and ce.status in ('available', 'reserved', 'paid');

  if promo_usage_count < promo_max_uses then
    new.promo_code_id := profile_promo_id;
  end if;

  return new;
end;
$$;
