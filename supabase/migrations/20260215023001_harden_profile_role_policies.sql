-- Prevent self-service role escalation on profiles.
-- Keep normal profile edits for consumers/business owners.

alter table public.profiles enable row level security;

drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Staff can read all profiles" on public.profiles;
drop policy if exists "Staff can update profiles" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and coalesce(role, 'consumer') in ('consumer', 'business_owner')
);

create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and coalesce(role, 'consumer') in ('consumer', 'business_owner')
);

create policy "Staff can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_staff());

create policy "Staff can update profiles"
on public.profiles
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());
