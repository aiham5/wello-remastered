-- Keep business-owner offer management working while limiting admin-side
-- privileges to profiles.role = 'admin'.

alter table public.offers enable row level security;

drop policy if exists "Admin can insert offers" on public.offers;
drop policy if exists "Offers insert access" on public.offers;
create policy "Offers insert access"
on public.offers
for insert
to public
with check (
  (select public.is_admin())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

drop policy if exists "Admin can update offers" on public.offers;
drop policy if exists "Offers update access" on public.offers;
create policy "Offers update access"
on public.offers
for update
to public
using (
  (select public.is_admin())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
)
with check (
  (select public.is_admin())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

drop policy if exists "Admin can delete offers" on public.offers;
drop policy if exists "Offers delete access" on public.offers;
create policy "Offers delete access"
on public.offers
for delete
to public
using (
  (select public.is_admin())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);
