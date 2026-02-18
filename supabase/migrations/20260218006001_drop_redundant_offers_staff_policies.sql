-- Remove redundant offers staff policies.
-- Staff access is already covered by:
-- - "Offers update access"
-- - "Offers delete access"
-- Safe to run multiple times.

drop policy if exists "Staff can update offers" on public.offers;
drop policy if exists "Staff can delete offers" on public.offers;
