-- Remove promo assignments from user profiles when a promo code is deactivated.

-- Backfill: clear any existing profile assignments that point to inactive promo codes.
update public.profiles p
set promo_code_id = null
where p.promo_code_id is not null
  and exists (
    select 1
    from public.promo_codes pc
    where pc.id = p.promo_code_id
      and pc.active = false
  );

create or replace function public.clear_profiles_promo_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active = true and new.active = false then
    update public.profiles
    set promo_code_id = null
    where promo_code_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_profiles_promo_on_deactivate on public.promo_codes;

create trigger clear_profiles_promo_on_deactivate
after update of active on public.promo_codes
for each row
when (old.active is distinct from new.active)
execute function public.clear_profiles_promo_on_deactivate();

