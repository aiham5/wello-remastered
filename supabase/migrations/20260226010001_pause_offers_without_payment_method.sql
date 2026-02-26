-- Enforce payment readiness for offer activation and auto-pause offers when billing method is removed.
-- Safe to run multiple times.

-- Require active offers to have valid Stripe account + payment method for owner updates.
drop policy if exists "Offers update access" on public.offers;

create policy "Offers update access"
on public.offers
for update
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
)
with check (
  (select public.is_staff())
  or (
    (select auth.uid()) = (
      select b.owner_id
      from public.businesses b
      where b.id = offers.business_id
    )
    and (
      coalesce(offers.active, false) = false
      or exists (
        select 1
        from public.businesses b
        where b.id = offers.business_id
          and nullif(b.stripe_account_id, '') is not null
          and nullif(b.stripe_payment_method_id, '') is not null
      )
    )
  )
);

create or replace function public.pause_offers_when_business_payment_method_missing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    nullif(old.stripe_account_id, '') is not null
    and nullif(old.stripe_payment_method_id, '') is not null
  )
  and not (
    nullif(new.stripe_account_id, '') is not null
    and nullif(new.stripe_payment_method_id, '') is not null
  ) then
    update public.offers
    set active = false
    where business_id = new.id
      and active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pause_offers_when_payment_method_missing on public.businesses;

create trigger trg_pause_offers_when_payment_method_missing
after update of stripe_account_id, stripe_payment_method_id
on public.businesses
for each row
execute function public.pause_offers_when_business_payment_method_missing();
