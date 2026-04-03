create table if not exists public.business_manual_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'canceled')),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  failure_reason text,
  charged_at timestamptz,
  canceled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_manual_charges_business_id_idx
  on public.business_manual_charges (business_id, created_at desc);

create index if not exists business_manual_charges_status_idx
  on public.business_manual_charges (status, created_at desc);

alter table public.business_manual_charges enable row level security;

create policy "Business manual charges select access"
on public.business_manual_charges for select
using (
  public.is_staff()
  or auth.uid() = (
    select b.owner_id
    from public.businesses b
    where b.id = business_id
  )
);

create policy "Business manual charges staff write"
on public.business_manual_charges for all
using (public.is_staff())
with check (public.is_staff());
