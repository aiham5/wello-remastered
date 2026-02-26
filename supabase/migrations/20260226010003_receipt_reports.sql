-- Allow business owners to report suspicious/invalid receipts for admin review.

create table if not exists public.receipt_reports (
  id uuid primary key default gen_random_uuid(),
  receipt_upload_id uuid not null references public.receipt_uploads(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open',
  resolution_notes text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_reports_status_check
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint receipt_reports_reason_check
    check (
      reason in (
        'wrong_receipt',
        'duplicate_receipt',
        'incorrect_total',
        'suspicious_activity',
        'illegible_receipt',
        'other'
      )
    )
);

create index if not exists receipt_reports_business_created_idx
  on public.receipt_reports (business_id, created_at desc);

create index if not exists receipt_reports_receipt_created_idx
  on public.receipt_reports (receipt_upload_id, created_at desc);

create unique index if not exists receipt_reports_open_unique
  on public.receipt_reports (receipt_upload_id, reporter_id)
  where status in ('open', 'reviewing');

drop trigger if exists set_receipt_reports_updated_at on public.receipt_reports;
create trigger set_receipt_reports_updated_at
before update on public.receipt_reports
for each row execute function public.set_updated_at();

alter table public.receipt_reports enable row level security;

revoke all on table public.receipt_reports from anon;
grant select, insert, update on table public.receipt_reports to authenticated;
grant all on table public.receipt_reports to service_role;

drop policy if exists "Business owners can insert receipt reports" on public.receipt_reports;
create policy "Business owners can insert receipt reports"
on public.receipt_reports
for insert
to authenticated
with check (
  reporter_id = (select auth.uid())
  and exists (
    select 1
    from public.receipt_uploads ru
    join public.businesses b on b.id = ru.business_id
    where ru.id = receipt_reports.receipt_upload_id
      and ru.business_id = receipt_reports.business_id
      and b.owner_id = (select auth.uid())
  )
);

drop policy if exists "Owners and staff can read receipt reports" on public.receipt_reports;
create policy "Owners and staff can read receipt reports"
on public.receipt_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())
  or exists (
    select 1
    from public.businesses b
    where b.id = receipt_reports.business_id
      and b.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'supervisor')
  )
);

drop policy if exists "Staff can update receipt reports" on public.receipt_reports;
create policy "Staff can update receipt reports"
on public.receipt_reports
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'supervisor')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'supervisor')
  )
);
