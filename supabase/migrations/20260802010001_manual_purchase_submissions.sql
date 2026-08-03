create table if not exists public.manual_purchase_submissions (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null unique references public.redemptions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  payment_type text not null check (payment_type in ('card', 'cash', 'bank', 'other')),
  status text not null default 'processing'
    check (status in ('processing', 'approved', 'rejected', 'paid')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_purchase_submissions_user_idx
  on public.manual_purchase_submissions(user_id, created_at desc);

create index if not exists manual_purchase_submissions_business_idx
  on public.manual_purchase_submissions(business_id, created_at desc);

alter table public.manual_purchase_submissions enable row level security;

drop policy if exists "Users create their own manual purchases"
  on public.manual_purchase_submissions;
create policy "Users create their own manual purchases"
  on public.manual_purchase_submissions
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.redemptions r
      where r.id = redemption_id
        and r.business_id = business_id
        and r.scanned_by = auth.uid()
    )
  );

drop policy if exists "Users view their own manual purchases"
  on public.manual_purchase_submissions;
create policy "Users view their own manual purchases"
  on public.manual_purchase_submissions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Business members view manual purchases"
  on public.manual_purchase_submissions;
create policy "Business members view manual purchases"
  on public.manual_purchase_submissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = manual_purchase_submissions.business_id
        and bm.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.businesses b
      where b.id = manual_purchase_submissions.business_id
        and b.owner_id = auth.uid()
    )
  );

drop policy if exists "Admins manage manual purchases"
  on public.manual_purchase_submissions;
create policy "Admins manage manual purchases"
  on public.manual_purchase_submissions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.set_manual_purchase_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_manual_purchase_updated_at
  on public.manual_purchase_submissions;
create trigger set_manual_purchase_updated_at
before update on public.manual_purchase_submissions
for each row execute function public.set_manual_purchase_updated_at();

