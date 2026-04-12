create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  business_id uuid references public.businesses(id) on delete cascade not null,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz default now(),
  unique(user_id, business_id)
);

create index if not exists business_members_user_id_idx
on public.business_members(user_id);

create index if not exists business_members_business_id_idx
on public.business_members(business_id);

alter table public.business_members enable row level security;
alter table public.businesses enable row level security;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
  );
$$;

create or replace function public.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.role = 'owner'
  );
$$;

drop policy if exists "Users can read own business memberships" on public.business_members;
drop policy if exists "Owners can read business memberships" on public.business_members;
drop policy if exists "Owners can invite business members" on public.business_members;
drop policy if exists "Owners can update business members" on public.business_members;
drop policy if exists "Owners can delete business members" on public.business_members;

create policy "Users can read own business memberships"
on public.business_members for select
using (auth.uid() = user_id);

create policy "Owners can read business memberships"
on public.business_members for select
using (public.is_business_owner(business_id));

create policy "Owners can invite business members"
on public.business_members for insert
with check (public.is_business_owner(business_id));

create policy "Owners can update business members"
on public.business_members for update
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "Owners can delete business members"
on public.business_members for delete
using (public.is_business_owner(business_id));

drop policy if exists "Owners can read own businesses" on public.businesses;
drop policy if exists "Owners can update own businesses" on public.businesses;
drop policy if exists "Staff can update businesses" on public.businesses;
drop policy if exists "Staff can delete businesses" on public.businesses;
drop policy if exists "Members can read member businesses" on public.businesses;
drop policy if exists "Owners can update member businesses" on public.businesses;
drop policy if exists "Owners can delete own businesses" on public.businesses;

create policy "Members can read member businesses"
on public.businesses for select
using (public.is_business_member(id));

create policy "Owners can update member businesses"
on public.businesses for update
using (public.is_business_owner(id))
with check (public.is_business_owner(id));

create policy "Owners can delete own businesses"
on public.businesses for delete
using (public.is_business_owner(id));

insert into public.business_members (user_id, business_id, role)
select b.owner_id, b.id, 'owner'
from public.businesses b
where b.owner_id is not null
on conflict (user_id, business_id) do update
set role = 'owner';

create or replace function public.sync_business_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    return new;
  end if;

  insert into public.business_members (user_id, business_id, role)
  values (new.owner_id, new.id, 'owner')
  on conflict (user_id, business_id) do update
  set role = 'owner';

  return new;
end;
$$;

drop trigger if exists sync_business_owner_membership_trigger on public.businesses;

create trigger sync_business_owner_membership_trigger
after insert or update of owner_id on public.businesses
for each row
execute function public.sync_business_owner_membership();
