-- Block admins/owners/supervisors from redeeming offers.
-- This is enforced server-side so it cannot be bypassed by a modified client.

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

  if redeem_role is distinct from 'consumer' then
    raise exception 'Only consumer accounts can redeem offers';
  end if;

  return new;
end;
$$;

drop trigger if exists redemptions_block_non_consumers on public.redemptions;

create trigger redemptions_block_non_consumers
before insert on public.redemptions
for each row
execute function public.block_non_consumer_redemptions();

