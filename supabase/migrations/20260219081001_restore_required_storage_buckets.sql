-- Restore required storage buckets after pre-production data purge.
-- Keeps app upload paths functional.

insert into storage.buckets (id, name, public)
values
  ('offer-images', 'offer-images', true),
  ('receipt-images', 'receipt-images', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;
