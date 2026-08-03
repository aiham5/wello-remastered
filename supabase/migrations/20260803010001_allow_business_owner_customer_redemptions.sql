-- Business owners can also use Wello as customers at other businesses.
-- Keep self-redemptions blocked so an owner cannot earn cashback from their
-- own listing.

create or replace function public.block_non_consumer_redemptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  redeem_user_id uuid;
  redeem_role text;
begin
  redeem_user_id := coalesce(new.scanned_by, auth.uid());
  if redeem_user_id is null then
    raise exception 'Missing scanned_by user for redemption';
  end if;

  select role
    into redeem_role
  from public.profiles
  where id = redeem_user_id;

  if coalesce(redeem_role, 'consumer') not in ('consumer', 'business_owner') then
    raise exception 'Only customer and business owner accounts can redeem offers';
  end if;

  if redeem_role = 'business_owner' and exists (
    select 1
    from public.businesses
    where id = new.business_id
      and owner_id = redeem_user_id
  ) then
    raise exception 'Business owners cannot earn cashback from their own business';
  end if;

  return new;
end;
$$;

