-- Require payment setup before business owners can create offers.
-- Safe hardening: this only narrows INSERT eligibility for offers.

drop policy if exists "Offers insert access" on public.offers;

create policy "Offers insert access"
on public.offers
for insert
to public
with check (
  (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
      and nullif(b.stripe_account_id, '') is not null
      and nullif(b.stripe_payment_method_id, '') is not null
  )
);