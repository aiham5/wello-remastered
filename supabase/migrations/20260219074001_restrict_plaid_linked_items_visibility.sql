-- Restrict direct client visibility of plaid_linked_items.
-- Access token references should only be read through trusted server-side functions.

drop policy if exists "Staff can read plaid linked items"
on public.plaid_linked_items;
