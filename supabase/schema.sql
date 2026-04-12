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
alter table public.profiles
  add column if not exists points_balance integer not null default 0;
alter table public.profiles
  add column if not exists stripe_cashout_account_id text,
  add column if not exists stripe_cashout_payouts_enabled boolean not null default false,
  add column if not exists stripe_cashout_onboarded_at timestamptz;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users on delete set null,
  name text not null,
  address text,
  city text,
  state text,
  postal_code text,
  phone text,
  image_url text,
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
  offer_honor_policy_accepted boolean not null default false,
  offer_honor_policy_version text,
  offer_honor_policy_accepted_at timestamptz,
  offer_honor_policy_accepted_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses add column if not exists phone text;
alter table public.businesses
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists image_url text;
alter table public.businesses
  add column if not exists stripe_account_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_payment_method_brand text,
  add column if not exists stripe_payment_method_last4 text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_onboarded_at timestamptz,
  add column if not exists commission_enabled boolean not null default true,
  add column if not exists commission_rate_cents integer not null default 150,
  add column if not exists default_cashback_rate_bps integer not null default 1000;

alter table public.businesses
  add column if not exists offer_honor_policy_accepted boolean not null default false,
  add column if not exists offer_honor_policy_version text,
  add column if not exists offer_honor_policy_accepted_at timestamptz,
  add column if not exists offer_honor_policy_accepted_by uuid references auth.users on delete set null;

alter table public.businesses
  drop constraint if exists businesses_commission_rate_cents_check;

alter table public.businesses
  add constraint businesses_commission_rate_cents_check
  check (commission_rate_cents between 10 and 1000);

alter table public.businesses
  drop constraint if exists businesses_default_cashback_rate_bps_check;

alter table public.businesses
  add constraint businesses_default_cashback_rate_bps_check
  check (
    default_cashback_rate_bps >= 0
    and default_cashback_rate_bps <= (commission_rate_cents * 10)
  );

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
  offer_honor_commitment_accepted boolean not null default false,
  offer_honor_commitment_version text,
  offer_honor_commitment_accepted_at timestamptz,
  offer_honor_commitment_accepted_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offers
  add column if not exists offer_type text,
  add column if not exists offer_honor_commitment_accepted boolean not null default false,
  add column if not exists offer_honor_commitment_version text,
  add column if not exists offer_honor_commitment_accepted_at timestamptz,
  add column if not exists offer_honor_commitment_accepted_by uuid references auth.users on delete set null;

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

create table if not exists public.business_views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  offer_id uuid not null references public.offers on delete cascade,
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  business_id uuid references public.businesses on delete set null,
  offer_id uuid references public.offers on delete set null,
  redemption_id uuid references public.redemptions on delete set null,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_uploads (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.redemptions on delete cascade,
  business_id uuid not null references public.businesses on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.receipt_uploads
  add column if not exists receipt_total_cents integer,
  add column if not exists commission_due_cents integer,
  add column if not exists review_status text,
  add column if not exists review_notes text,
  add column if not exists reviewed_by uuid references auth.users on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.receipt_uploads
  alter column review_status set default 'pending';

alter table public.receipt_uploads
  drop constraint if exists receipt_uploads_review_status_check;

alter table public.receipt_uploads
  add constraint receipt_uploads_review_status_check
  check (review_status in ('pending', 'verified', 'rejected'));

create table if not exists public.commission_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  redemption_id uuid not null references public.redemptions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  amount_cents integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'invoiced', 'paid', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.cashback_events (
  id uuid primary key default gen_random_uuid(),
  receipt_upload_id uuid not null unique references public.receipt_uploads on delete cascade,
  redemption_id uuid not null unique references public.redemptions on delete cascade,
  business_id uuid not null references public.businesses on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'available'
    check (status in ('available', 'paid', 'reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cashout_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  stripe_account_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed')),
  stripe_transfer_id text,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cashback_events
  add column if not exists payout_id uuid references public.cashout_payouts on delete set null;

create table if not exists public.commission_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  stripe_invoice_id text,
  period_start date,
  period_end date,
  amount_cents integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  expo_push_token text not null,
  platform text,
  device_info text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  new_offer boolean not null default true,
  expiring_offer boolean not null default true,
  nearby_offer boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.user_locations (
  user_id uuid primary key references auth.users on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
create index if not exists businesses_location_idx
  on public.businesses(latitude, longitude);
create index if not exists offers_business_id_idx on public.offers(business_id);
create index if not exists business_views_business_id_idx
  on public.business_views(business_id);
create index if not exists business_views_user_id_idx
  on public.business_views(user_id);
create index if not exists business_views_created_idx
  on public.business_views(created_at);
create index if not exists offer_views_business_id_idx
  on public.offer_views(business_id);
create index if not exists offer_views_offer_id_idx
  on public.offer_views(offer_id);
create index if not exists offer_views_user_id_idx
  on public.offer_views(user_id);
create index if not exists offer_views_created_idx
  on public.offer_views(created_at);
create index if not exists change_requests_entity_idx
  on public.change_requests(entity_type, entity_id);
create index if not exists change_requests_business_idx
  on public.change_requests(business_id);
create index if not exists reviews_business_id_idx on public.reviews(business_id);
create index if not exists reviews_user_id_idx on public.reviews(user_id);
create index if not exists reviews_redemption_id_idx on public.reviews(redemption_id);
drop index if exists reviews_redemption_unique_idx;
create unique index if not exists reviews_user_business_unique_idx
  on public.reviews(user_id, business_id);
create unique index if not exists receipt_uploads_redemption_id_idx
  on public.receipt_uploads(redemption_id);
create index if not exists receipt_uploads_business_id_idx
  on public.receipt_uploads(business_id);
create index if not exists receipt_uploads_user_id_idx
  on public.receipt_uploads(user_id);
create unique index if not exists commission_events_redemption_id_idx
  on public.commission_events(redemption_id);
create index if not exists commission_events_business_id_idx
  on public.commission_events(business_id);
create index if not exists commission_events_status_idx
  on public.commission_events(status);
create index if not exists cashback_events_user_id_idx
  on public.cashback_events(user_id);
create index if not exists cashback_events_business_id_idx
  on public.cashback_events(business_id);
create index if not exists cashback_events_status_idx
  on public.cashback_events(status);
create index if not exists cashback_events_payout_id_idx
  on public.cashback_events(payout_id);
create index if not exists cashout_payouts_user_id_idx
  on public.cashout_payouts(user_id);
create index if not exists cashout_payouts_status_idx
  on public.cashout_payouts(status);
create index if not exists commission_invoices_business_id_idx
  on public.commission_invoices(business_id);
create index if not exists notification_tokens_token_idx
  on public.notification_tokens(expo_push_token);
create index if not exists user_locations_coords_idx
  on public.user_locations(latitude, longitude);

-- Points system (safe to re-run).
alter table if exists public.offers
  add column if not exists points_value integer;
alter table if exists public.redemptions
  add column if not exists points_awarded integer;

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

create or replace function public.require_business_offer_honor_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.offer_honor_policy_accepted is distinct from true then
    raise exception 'business_offer_honor_policy_required';
  end if;
  if coalesce(trim(new.offer_honor_policy_version), '') = '' then
    raise exception 'business_offer_honor_policy_version_required';
  end if;
  if new.offer_honor_policy_accepted_at is null then
    new.offer_honor_policy_accepted_at := now();
  end if;
  if new.offer_honor_policy_accepted_by is null then
    new.offer_honor_policy_accepted_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.require_offer_honor_commitment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  needs_enforcement boolean := false;
begin
  if tg_op = 'INSERT' then
    needs_enforcement := true;
  elsif new.approval_status = 'pending'
        and coalesce(old.approval_status, '') <> 'pending' then
    needs_enforcement := true;
  end if;

  if needs_enforcement then
    if new.offer_honor_commitment_accepted is distinct from true then
      raise exception 'offer_honor_commitment_required';
    end if;
    if coalesce(trim(new.offer_honor_commitment_version), '') = '' then
      raise exception 'offer_honor_commitment_version_required';
    end if;
    if new.offer_honor_commitment_accepted_at is null then
      new.offer_honor_commitment_accepted_at := now();
    end if;
    if new.offer_honor_commitment_accepted_by is null then
      new.offer_honor_commitment_accepted_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.increment_points(target_user uuid, delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user is null then
    return;
  end if;
  update public.profiles
  set points_balance = coalesce(points_balance, 0) + coalesce(delta, 0)
  where id = target_user;
end;
$$;

create or replace function public.award_points_on_redemption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta integer;
begin
  if new.points_awarded is null then
    return new;
  end if;
  if old.points_awarded is null then
    delta := new.points_awarded;
  else
    delta := new.points_awarded - old.points_awarded;
  end if;
  if delta <> 0 then
    perform public.increment_points(new.scanned_by, delta);
  end if;
  return new;
end;
$$;

create or replace function public.award_points_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.increment_points(new.user_id, 50);
  return new;
end;
$$;

create or replace function public.sync_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cashback_cents integer := 0;
begin
  if coalesce(new.commission_due_cents, 0) > 0 then
    cashback_cents := round((new.commission_due_cents::numeric) * 0.05)::integer;
  end if;

  if new.review_status = 'verified'
     and new.commission_due_cents is not null
     and new.commission_due_cents > 0 then
    insert into public.commission_events (
      business_id,
      redemption_id,
      user_id,
      amount_cents,
      status
    )
    values (
      new.business_id,
      new.redemption_id,
      new.user_id,
      new.commission_due_cents,
      'pending'
    )
    on conflict (redemption_id) do update
      set amount_cents = case
            when commission_events.status in ('invoiced', 'paid')
              then commission_events.amount_cents
            else excluded.amount_cents
          end,
          business_id = excluded.business_id,
          user_id = excluded.user_id,
          status = case
            when commission_events.status in ('invoiced', 'paid')
              then commission_events.status
            else 'pending'
          end;
  else
    update public.commission_events
      set status = 'failed'
      where redemption_id = new.redemption_id
        and status = 'pending';
  end if;

  if new.review_status = 'verified' and cashback_cents > 0 then
    insert into public.cashback_events (
      receipt_upload_id,
      redemption_id,
      business_id,
      user_id,
      amount_cents,
      status
    )
    values (
      new.id,
      new.redemption_id,
      new.business_id,
      new.user_id,
      cashback_cents,
      'available'
    )
    on conflict (receipt_upload_id) do update
      set amount_cents = case
            when cashback_events.status = 'paid'
              then cashback_events.amount_cents
            else excluded.amount_cents
          end,
          redemption_id = excluded.redemption_id,
          business_id = excluded.business_id,
          user_id = excluded.user_id,
          status = case
            when cashback_events.status = 'paid'
              then cashback_events.status
            else 'available'
          end;
  else
    update public.cashback_events
      set status = 'reversed'
      where receipt_upload_id = new.id
        and status = 'available';
  end if;

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

drop trigger if exists set_cashback_events_updated_at on public.cashback_events;
create trigger set_cashback_events_updated_at
before update on public.cashback_events
for each row execute function public.set_updated_at();

drop trigger if exists set_cashout_payouts_updated_at on public.cashout_payouts;
create trigger set_cashout_payouts_updated_at
before update on public.cashout_payouts
for each row execute function public.set_updated_at();

drop trigger if exists set_offers_updated_at on public.offers;
create trigger set_offers_updated_at
before update on public.offers
for each row execute function public.set_updated_at();

drop trigger if exists require_business_offer_honor_policy on public.businesses;
create trigger require_business_offer_honor_policy
before insert on public.businesses
for each row execute function public.require_business_offer_honor_policy();

drop trigger if exists require_offer_honor_commitment on public.offers;
create trigger require_offer_honor_commitment
before insert or update on public.offers
for each row execute function public.require_offer_honor_commitment();

drop trigger if exists award_points_on_redemption on public.redemptions;
create trigger award_points_on_redemption
after update of points_awarded on public.redemptions
for each row execute function public.award_points_on_redemption();

drop trigger if exists award_points_on_review on public.reviews;
create trigger award_points_on_review
after insert on public.reviews
for each row execute function public.award_points_on_review();

drop trigger if exists sync_commission_event on public.receipt_uploads;
create trigger sync_commission_event
after update of review_status, commission_due_cents, receipt_total_cents on public.receipt_uploads
for each row execute function public.sync_commission_event();

insert into public.commission_events (
  business_id,
  redemption_id,
  user_id,
  amount_cents,
  status
)
select
  ru.business_id,
  ru.redemption_id,
  ru.user_id,
  ru.commission_due_cents,
  'pending'
from public.receipt_uploads ru
where ru.review_status = 'verified'
  and coalesce(ru.commission_due_cents, 0) > 0
on conflict (redemption_id) do update
  set amount_cents = case
        when commission_events.status in ('invoiced', 'paid')
          then commission_events.amount_cents
        else excluded.amount_cents
      end,
      business_id = excluded.business_id,
      user_id = excluded.user_id,
      status = case
        when commission_events.status in ('invoiced', 'paid')
          then commission_events.status
        else 'pending'
      end;

insert into public.cashback_events (
  receipt_upload_id,
  redemption_id,
  business_id,
  user_id,
  amount_cents,
  status
)
select
  ru.id,
  ru.redemption_id,
  ru.business_id,
  ru.user_id,
  round((ru.commission_due_cents::numeric) * 0.05)::integer,
  'available'
from public.receipt_uploads ru
where ru.review_status = 'verified'
  and coalesce(ru.commission_due_cents, 0) > 0
on conflict (receipt_upload_id) do update
  set amount_cents = case
        when cashback_events.status = 'paid'
          then cashback_events.amount_cents
        else excluded.amount_cents
      end,
      redemption_id = excluded.redemption_id,
      business_id = excluded.business_id,
      user_id = excluded.user_id,
      status = case
        when cashback_events.status = 'paid'
          then cashback_events.status
        else 'available'
      end;

-- Row level security (RLS)
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.offers enable row level security;
alter table public.change_requests enable row level security;
alter table public.redemptions enable row level security;
alter table public.business_views enable row level security;
alter table public.offer_views enable row level security;
alter table public.reviews enable row level security;
alter table public.notification_tokens enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.user_locations enable row level security;
alter table public.receipt_uploads enable row level security;
alter table public.commission_events enable row level security;
alter table public.cashback_events enable row level security;
alter table public.cashout_payouts enable row level security;
alter table public.commission_invoices enable row level security;

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
drop policy if exists "Staff can delete businesses" on public.businesses;
drop policy if exists "Offers are public read" on public.offers;
drop policy if exists "Staff can read offers" on public.offers;
drop policy if exists "Owners can read own offers" on public.offers;
drop policy if exists "Owners can manage offers" on public.offers;
drop policy if exists "Owners can insert offers" on public.offers;
drop policy if exists "Staff can update offers" on public.offers;
drop policy if exists "Staff can delete offers" on public.offers;
drop policy if exists "Owners can create change requests" on public.change_requests;
drop policy if exists "Owners can read their change requests" on public.change_requests;
drop policy if exists "Staff can read change requests" on public.change_requests;
drop policy if exists "Staff can update change requests" on public.change_requests;
drop policy if exists "Owners can read redemptions" on public.redemptions;
drop policy if exists "Users can read own redemptions" on public.redemptions;
drop policy if exists "Users can create redemptions" on public.redemptions;
drop policy if exists "Users can update own redemptions" on public.redemptions;
drop policy if exists "Users can create views" on public.business_views;
drop policy if exists "Owners can read views" on public.business_views;
drop policy if exists "Staff can read views" on public.business_views;
drop policy if exists "Users can create offer views" on public.offer_views;
drop policy if exists "Owners can read offer views" on public.offer_views;
drop policy if exists "Staff can read offer views" on public.offer_views;
drop policy if exists "Users can read own reviews" on public.reviews;
drop policy if exists "Reviews are public read" on public.reviews;
drop policy if exists "Users can create reviews" on public.reviews;
drop policy if exists "Users can manage notification tokens"
  on public.notification_tokens;
drop policy if exists "Staff can read notification tokens"
  on public.notification_tokens;
drop policy if exists "Users can manage notification preferences"
  on public.notification_preferences;
drop policy if exists "Users can manage user locations"
  on public.user_locations;
drop policy if exists "Staff can read user locations"
  on public.user_locations;
drop policy if exists "Users can upload receipts"
  on public.receipt_uploads;
drop policy if exists "Users can read own receipts"
  on public.receipt_uploads;
drop policy if exists "Owners can read receipts"
  on public.receipt_uploads;
drop policy if exists "Users can create commission events"
  on public.commission_events;
drop policy if exists "Owners can read commission events"
  on public.commission_events;
drop policy if exists "Staff can read commission events"
  on public.commission_events;
drop policy if exists "Staff can manage commission events"
  on public.commission_events;
drop policy if exists "Users can read own cashback events"
  on public.cashback_events;
drop policy if exists "Staff can read cashback events"
  on public.cashback_events;
drop policy if exists "Staff can manage cashback events"
  on public.cashback_events;
drop policy if exists "Users can read own cashout payouts"
  on public.cashout_payouts;
drop policy if exists "Staff can read cashout payouts"
  on public.cashout_payouts;
drop policy if exists "Staff can manage cashout payouts"
  on public.cashout_payouts;
drop policy if exists "Staff can read commission invoices"
  on public.commission_invoices;

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
using (auth.uid() = id)
with check (
  auth.uid() = id
  and coalesce(role, 'consumer') in ('consumer', 'business_owner')
);

create policy "Profiles are insertable by owners"
on public.profiles for insert
with check (
  auth.uid() = id
  and coalesce(role, 'consumer') in ('consumer', 'business_owner')
);

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

create policy "Staff can delete businesses"
on public.businesses for delete
using (public.is_staff());

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

create policy "Staff can delete offers"
on public.offers for delete
using (public.is_staff());

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

create policy "Users can read own redemptions"
on public.redemptions for select
using (auth.uid() = scanned_by);

create policy "Staff can read redemptions"
on public.redemptions for select
using (public.is_staff());

create policy "Users can create redemptions"
on public.redemptions for insert
with check (auth.uid() is not null and scanned_by = auth.uid());

create policy "Users can update own redemptions"
on public.redemptions for update
using (
  auth.uid() = scanned_by
  or exists (
    select 1 from public.receipt_uploads ru
    where ru.redemption_id = id
      and ru.user_id = auth.uid()
  )
)
with check (
  auth.uid() = scanned_by
  or exists (
    select 1 from public.receipt_uploads ru
    where ru.redemption_id = id
      and ru.user_id = auth.uid()
  )
);

create policy "Users can create views"
on public.business_views for insert
with check (auth.uid() = user_id);

create policy "Owners can read views"
on public.business_views for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Staff can read views"
on public.business_views for select
using (public.is_staff());

create policy "Users can create offer views"
on public.offer_views for insert
with check (auth.uid() = user_id);

create policy "Owners can read offer views"
on public.offer_views for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Staff can read offer views"
on public.offer_views for select
using (public.is_staff());

create policy "Users can read own reviews"
on public.reviews for select
using (auth.uid() = user_id);

create policy "Reviews are public read"
on public.reviews for select
using (true);

create policy "Users can create reviews"
on public.reviews for insert
with check (auth.uid() is not null and user_id = auth.uid());

create policy "Users can manage notification tokens"
on public.notification_tokens for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Staff can read notification tokens"
on public.notification_tokens for select
using (public.is_staff());

create policy "Users can manage notification preferences"
on public.notification_preferences for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can manage user locations"
on public.user_locations for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Staff can read user locations"
on public.user_locations for select
using (public.is_staff());

create policy "Users can upload receipts"
on public.receipt_uploads for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.redemptions r
    where r.id = redemption_id
      and r.scanned_by = auth.uid()
  )
);

create policy "Users can read own receipts"
on public.receipt_uploads for select
using (auth.uid() = user_id);

create policy "Owners can read receipts"
on public.receipt_uploads for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Staff can read receipts"
on public.receipt_uploads for select
using (public.is_staff());

create policy "Staff can update receipts"
on public.receipt_uploads for update
using (public.is_staff())
with check (public.is_staff());

create policy "Users can create commission events"
on public.commission_events for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.redemptions r
    where r.id = redemption_id
      and r.scanned_by = auth.uid()
  )
);

create policy "Owners can read commission events"
on public.commission_events for select
using (
  auth.uid() = (
    select owner_id from public.businesses where id = business_id
  )
);

create policy "Staff can read commission events"
on public.commission_events for select
using (public.is_staff());

create policy "Staff can manage commission events"
on public.commission_events for update
using (public.is_staff())
with check (public.is_staff());

create policy "Users can read own cashback events"
on public.cashback_events for select
using (auth.uid() = user_id);

create policy "Staff can read cashback events"
on public.cashback_events for select
using (public.is_staff());

create policy "Staff can manage cashback events"
on public.cashback_events for update
using (public.is_staff())
with check (public.is_staff());

create policy "Users can read own cashout payouts"
on public.cashout_payouts for select
using (auth.uid() = user_id);

create policy "Staff can read cashout payouts"
on public.cashout_payouts for select
using (public.is_staff());

create policy "Staff can manage cashout payouts"
on public.cashout_payouts for update
using (public.is_staff())
with check (public.is_staff());

create policy "Staff can read commission invoices"
on public.commission_invoices for select
using (public.is_staff());

-- Storage (offer images)
insert into storage.buckets (id, name, public)
values ('offer-images', 'offer-images', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('receipt-images', 'receipt-images', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Offer images are public read" on storage.objects;
drop policy if exists "Business owners can upload offer images" on storage.objects;
drop policy if exists "Authenticated users can upload offer images" on storage.objects;
drop policy if exists "Staff can delete offer images" on storage.objects;
drop policy if exists "Receipt images are readable by owners" on storage.objects;
drop policy if exists "Authenticated users can upload receipt images"
  on storage.objects;

create policy "Offer images are public read"
on storage.objects for select
using (bucket_id = 'offer-images');

create policy "Authenticated users can upload offer images"
on storage.objects for insert
with check (
  bucket_id = 'offer-images'
  and auth.uid() is not null
);

create policy "Staff can delete offer images"
on storage.objects for delete
using (
  bucket_id = 'offer-images'
  and public.is_staff()
);

create policy "Receipt images are readable by owners"
on storage.objects for select
using (
  bucket_id = 'receipt-images'
  and exists (
    select 1
    from public.receipt_uploads ru
    join public.businesses b on b.id = ru.business_id
    where ru.storage_path = storage.objects.name
      and b.owner_id = auth.uid()
  )
);

create policy "Authenticated users can upload receipt images"
on storage.objects for insert
with check (
  bucket_id = 'receipt-images'
  and auth.uid() is not null
);
