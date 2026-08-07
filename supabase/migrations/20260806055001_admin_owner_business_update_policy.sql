-- Business listing updates remain available to the business owner, while
-- admin-side edits require profiles.role = 'admin' instead of broad staff.

alter table public.businesses enable row level security;

drop policy if exists "Admin can update businesses" on public.businesses;
drop policy if exists "Businesses update access" on public.businesses;
create policy "Businesses update access"
on public.businesses
for update
to public
using (
  (select public.is_admin())
  or (select auth.uid()) = owner_id
)
with check (
  (select public.is_admin())
  or (select auth.uid()) = owner_id
);
