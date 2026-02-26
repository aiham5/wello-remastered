-- Require users to have earned cashback from a business before leaving a review.
-- Also require the referenced redemption to belong to that user and business.
-- Safe to run multiple times.

drop policy if exists "Users can create reviews" on public.reviews;

create policy "Users can create reviews"
on public.reviews
for insert
to public
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and business_id is not null
  and redemption_id is not null
  and exists (
    select 1
    from public.redemptions r
    where r.id = reviews.redemption_id
      and r.scanned_by = (select auth.uid())
      and r.business_id = reviews.business_id
  )
  and exists (
    select 1
    from public.cashback_events ce
    where ce.user_id = (select auth.uid())
      and ce.business_id = reviews.business_id
      and coalesce(ce.amount_cents, 0) > 0
      and ce.status in ('available', 'reserved', 'paid')
  )
);
