-- Admin-only mobile admin actions.
-- The app uses profiles.role = 'admin' as the existing admin flag.

alter table public.businesses enable row level security;
alter table public.offers enable row level security;
alter table public.receipt_uploads enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "Staff can update businesses" on public.businesses;
drop policy if exists "Admin can update businesses" on public.businesses;
create policy "Admin can update businesses"
on public.businesses for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Staff can delete businesses" on public.businesses;
drop policy if exists "Admin can delete businesses" on public.businesses;
create policy "Admin can delete businesses"
on public.businesses for delete
using (public.is_admin());

drop policy if exists "Staff can update offers" on public.offers;
drop policy if exists "Offers update access" on public.offers;
drop policy if exists "Admin can update offers" on public.offers;
create policy "Admin can update offers"
on public.offers for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Staff can delete offers" on public.offers;
drop policy if exists "Offers delete access" on public.offers;
drop policy if exists "Admin can delete offers" on public.offers;
create policy "Admin can delete offers"
on public.offers for delete
using (public.is_admin());

drop policy if exists "Offers insert access" on public.offers;
drop policy if exists "Admin can insert offers" on public.offers;
create policy "Admin can insert offers"
on public.offers for insert
with check (
  public.is_admin()
  or exists (
    select 1
    from public.businesses b
    where b.id = offers.business_id
      and b.owner_id = auth.uid()
      and coalesce(b.stripe_onboarded, false) = true
      and b.stripe_payment_method_id is not null
      and coalesce(b.stripe_gated, false) = false
  )
);

drop policy if exists "Staff can update receipts" on public.receipt_uploads;
drop policy if exists "Receipt uploads update access" on public.receipt_uploads;
drop policy if exists "Admin can update receipts" on public.receipt_uploads;
create policy "Admin can update receipts"
on public.receipt_uploads for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admin can update reviews" on public.reviews;
create policy "Admin can update reviews"
on public.reviews for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admin can delete reviews" on public.reviews;
create policy "Admin can delete reviews"
on public.reviews for delete
using (public.is_admin());
