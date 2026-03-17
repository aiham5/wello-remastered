create table if not exists public.trade_receipt_owner_responses (
  id uuid primary key default gen_random_uuid(),
  receipt_upload_id uuid not null unique references public.receipt_uploads(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('accepted', 'disputed')),
  dispute_reason text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint trade_receipt_owner_responses_dispute_reason_check
    check (
      (response = 'accepted' and dispute_reason is null)
      or (response = 'disputed' and length(trim(coalesce(dispute_reason, ''))) > 0)
    )
);

create index if not exists idx_trade_receipt_owner_responses_business_id
  on public.trade_receipt_owner_responses (business_id);

create index if not exists idx_trade_receipt_owner_responses_owner_id
  on public.trade_receipt_owner_responses (owner_id);

drop trigger if exists set_trade_receipt_owner_responses_updated_at
  on public.trade_receipt_owner_responses;

create trigger set_trade_receipt_owner_responses_updated_at
before update on public.trade_receipt_owner_responses
for each row execute function public.set_updated_at();

alter table public.trade_receipt_owner_responses enable row level security;

drop policy if exists "Trade receipt owner responses select access"
  on public.trade_receipt_owner_responses;
create policy "Trade receipt owner responses select access"
on public.trade_receipt_owner_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = trade_receipt_owner_responses.business_id
      and b.owner_id = auth.uid()
  )
  or (select public.is_staff())
);

drop policy if exists "Trade receipt owner responses insert access"
  on public.trade_receipt_owner_responses;
create policy "Trade receipt owner responses insert access"
on public.trade_receipt_owner_responses
for insert
to authenticated
with check (
  (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = trade_receipt_owner_responses.business_id
        and b.owner_id = auth.uid()
    )
  )
  or (select public.is_staff())
);

drop policy if exists "Trade receipt owner responses update access"
  on public.trade_receipt_owner_responses;
create policy "Trade receipt owner responses update access"
on public.trade_receipt_owner_responses
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = trade_receipt_owner_responses.business_id
      and b.owner_id = auth.uid()
  )
  or (select public.is_staff())
)
with check (
  (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = trade_receipt_owner_responses.business_id
        and b.owner_id = auth.uid()
    )
  )
  or (select public.is_staff())
);
