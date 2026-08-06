-- Allow a customer to review a business immediately after submitting checkout
-- evidence. The review must still reference the customer's own redemption and
-- business. A written review remains optional; the existing rating constraint
-- continues to require a valid star rating.

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
  and (
    exists (
      select 1
      from public.cashback_events ce
      where ce.user_id = (select auth.uid())
        and ce.business_id = reviews.business_id
        and coalesce(ce.amount_cents, 0) > 0
        and ce.status in ('available', 'reserved', 'paid')
    )
    or exists (
      select 1
      from public.receipt_uploads ru
      where ru.redemption_id = reviews.redemption_id
        and ru.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.manual_purchase_submissions mps
      where mps.redemption_id = reviews.redemption_id
        and mps.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.redemptions r
      where r.id = reviews.redemption_id
        and r.scanned_by = (select auth.uid())
        and r.qr_payload like 'wello_manual_purchase:%'
    )
  )
);
