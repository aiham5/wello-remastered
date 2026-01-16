-- Wello starter schema (Supabase/Postgres)
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  phone text,
  company text,
  role text not null default 'consumer'
    check (role in ('consumer', 'business_owner', 'supervisor', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('consumer', 'business_owner', 'supervisor', 'admin'));
alter table public.profiles alter column role set default 'consumer';
alter table public.profiles
  add column if not exists phone text,
  add column if not exists company text;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users on delete set null,
  name text not null,
  address text,
  city text,
  state text,
  postal_code text,
  phone text,
  category_key text not null,
  category_label text not null,
  offer_highlight text,
  hours text,
  tags text[] not null default '{}'::text[],
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  subscription_plan text,
  subscription_price_cents integer,
  qr_code text unique,
  is_open boolean not null default true,
  approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses add column if not exists phone text;
alter table public.businesses
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  title text not null,
  description text,
  offer_type text,
  image_url text,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offers
  add column if not exists offer_type text;

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('business', 'offer')),
  entity_id uuid not null,
  business_id uuid references public.businesses on delete cascade,
  submitted_by uuid references auth.users on delete set null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  offer_id uuid references public.offers on delete set null,
  qr_payload text,
  scanned_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
create index if not exists businesses_location_idx
  on public.businesses(latitude, longitude);
create index if not exists offers_business_id_idx on public.offers(business_id);
create index if not exists change_requests_entity_idx
  on public.change_requests(entity_type, entity_id);
create index if not exists change_requests_business_idx
  on public.change_requests(business_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'supervisor')
  );
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_businesses_updated_at on public.businesses;
create trigger set_businesses_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists set_offers_updated_at on public.offers;
create trigger set_offers_updated_at
before update on public.offers
for each row execute function public.set_updated_at();

-- Row level security (RLS)
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.offers enable row level security;
alter table public.change_requests enable row level security;
alter table public.redemptions enable row level security;

-- Drop existing policies to keep this script idempotent.
drop policy if exists "Invites are readable" on public.invites;
drop policy if exists "Invites are insertable" on public.invites;
drop policy if exists "Invites can be claimed once" on public.invites;
drop policy if exists "Profiles are readable by owners" on public.profiles;
drop policy if exists "Profiles are editable by owners" on public.profiles;
drop policy if exists "Profiles are insertable by owners" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;
drop policy if exists "Businesses are public read" on public.businesses;
drop policy if exists "Staff can read businesses" on public.businesses;
drop policy if exists "Owners can read own businesses" on public.businesses;
drop policy if exists "Owners can insert businesses" on public.businesses;
drop policy if exists "Owners can update own businesses" on public.businesses;
drop policy if exists "Staff can update businesses" on public.businesses;
drop policy if exists "Offers are public read" on public.offers;
drop policy if exists "Staff can read offers" on public.offers;
drop policy if exists "Owners can read own offers" on public.offers;
drop policy if exists "Owners can manage offers" on public.offers;
drop policy if exists "Owners can insert offers" on public.offers;
drop policy if exists "Staff can update offers" on public.offers;
drop policy if exists "Owners can create change requests" on public.change_requests;
drop policy if exists "Owners can read their change requests" on public.change_requests;
drop policy if exists "Staff can read change requests" on public.change_requests;
drop policy if exists "Staff can update change requests" on public.change_requests;
drop policy if exists "Owners can read redemptions" on public.redemptions;
drop policy if exists "Users can create redemptions" on public.redemptions;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  role text not null
    check (role in ('business_owner')),
  generated_by text,
  used_by text,
  used_by_name text,
  used_by_business_name text,
  used_by_user_id uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check check (role in ('business_owner'));

alter table public.invites
  add column if not exists used_by_name text,
  add column if not exists used_by_business_name text,
  add column if not exists used_by_user_id uuid;

alter table public.invites enable row level security;

create policy "Invites are readable"
on public.invites for select
using (true);

create policy "Invites are insertable"
on public.invites for insert
with check (public.is_admin());

create policy "Invites can be claimed once"
on public.invites for update
using (used_at is null);

-- Profiles
create policy "Profiles are readable by owners"
on public.profiles for select
using (auth.uid() = id);

create policy "Profiles are editable by owners"
on public.profiles for update
using (auth.uid() = id);

create policy "Profiles are insertable by owners"
on public.profiles for insert
with check (auth.uid() = id);

create policy "Admins can read all profiles"
on public.profiles for select
using (public.is_admin());

create policy "Admins can update profiles"
on public.profiles for update
using (public.is_admin());

-- Businesses
create policy "Businesses are public read"
on public.businesses for select
using (approval_status = 'approved' and status = 'active');

create policy "Staff can read businesses"
on public.businesses for select
using (public.is_staff());

create policy "Owners can read own businesses"
on public.businesses for select
using (auth.uid() = owner_id);

create policy "Owners can insert businesses"
on public.businesses for insert
with check (auth.uid() = owner_id);

create policy "Owners can update own businesses"
on public.businesses for update
using (auth.uid() = owner_id);

create policy "Staff can update businesses"
on public.businesses for update
using (public.is_staff())
with check (public.is_staff());

-- Offers
create policy "Offers are public read"
on public.offers for select
using (approval_status = 'approved' and active = true);

create policy "Staff can read offers"
on public.offers for select
using (public.is_staff());

create policy "Owners can read own offers"
on public.offers for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Owners can manage offers"
on public.offers for all
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
)
with check (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Staff can update offers"
on public.offers for update
using (public.is_staff())
with check (public.is_staff());

-- Change requests
create policy "Owners can create change requests"
on public.change_requests for insert
with check (auth.uid() = submitted_by);

create policy "Owners can read their change requests"
on public.change_requests for select
using (auth.uid() = submitted_by);

create policy "Staff can read change requests"
on public.change_requests for select
using (public.is_staff());

create policy "Staff can update change requests"
on public.change_requests for update
using (public.is_staff())
with check (public.is_staff());

-- Redemptions (service role recommended for inserts)
create policy "Owners can read redemptions"
on public.redemptions for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Users can create redemptions"
on public.redemptions for insert
with check (auth.uid() is not null and scanned_by = auth.uid());

-- Storage (offer images)
insert into storage.buckets (id, name, public)
values ('offer-images', 'offer-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Offer images are public read" on storage.objects;
drop policy if exists "Business owners can upload offer images" on storage.objects;
drop policy if exists "Authenticated users can upload offer images" on storage.objects;

create policy "Offer images are public read"
on storage.objects for select
using (bucket_id = 'offer-images');

create policy "Authenticated users can upload offer images"
on storage.objects for insert
with check (
  bucket_id = 'offer-images'
  and auth.uid() is not null
);
