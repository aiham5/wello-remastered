-- Enforce promo per-user limits strictly:
-- - Count both confirmed cashback events and staged receipt uploads.
-- - Remove promo assignment from profiles as soon as limit is exhausted.
-- - Prevent additional receipt uploads from inheriting the promo once exhausted.

create index if not exists receipt_uploads_user_promo_review_status_idx
  on public.receipt_uploads(user_id, promo_code_id, review_status)
  where promo_code_id is not null;

create or replace function public.count_user_promo_uses(
  p_user_id uuid,
  p_promo_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with confirmed as (
    select count(*)::integer as c
      from public.cashback_events ce
      where ce.user_id = p_user_id
        and ce.promo_code_id = p_promo_id
        and ce.status in ('available', 'reserved', 'paid')
  ),
  staged_without_confirmed_event as (
    select count(*)::integer as c
      from public.receipt_uploads ru
      where ru.user_id = p_user_id
        and ru.promo_code_id = p_promo_id
        and coalesce(ru.review_status, 'pending') in ('pending', 'verified')
        and not exists (
          select 1
            from public.cashback_events ce
            where ce.receipt_upload_id = ru.id
              and ce.user_id = ru.user_id
              and ce.promo_code_id = ru.promo_code_id
              and ce.status in ('available', 'reserved', 'paid')
        )
  )
  select coalesce((select c from confirmed), 0)
       + coalesce((select c from staged_without_confirmed_event), 0);
$$;

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

  -- Count all uses that should consume quota for this account.
  promo_usage_count := public.count_user_promo_uses(new.user_id, profile_promo_id);

  if promo_usage_count < promo_max_uses then
    new.promo_code_id := profile_promo_id;
    return new;
  end if;

  -- Exhausted: clear profile assignment so the promo is removed from account.
  update public.profiles p
    set promo_code_id = null
    where p.id = new.user_id
      and p.promo_code_id = profile_promo_id;

  return new;
end;
$$;

-- Cleanup existing accounts that have already exhausted their assigned promo.
update public.profiles p
set promo_code_id = null
from public.promo_codes pc
where p.promo_code_id = pc.id
  and pc.max_uses_per_user is not null
  and pc.max_uses_per_user > 0
  and public.count_user_promo_uses(p.id, pc.id) >= pc.max_uses_per_user;

