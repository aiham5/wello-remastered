-- Adds customer cashback (5%) for verified receipts.
-- Safe to run multiple times.

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

create index if not exists cashback_events_user_id_idx
  on public.cashback_events(user_id);
create index if not exists cashback_events_business_id_idx
  on public.cashback_events(business_id);
create index if not exists cashback_events_status_idx
  on public.cashback_events(status);

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

drop trigger if exists set_cashback_events_updated_at on public.cashback_events;
create trigger set_cashback_events_updated_at
before update on public.cashback_events
for each row execute function public.set_updated_at();

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

alter table public.cashback_events enable row level security;

drop policy if exists "Users can read own cashback events"
  on public.cashback_events;
drop policy if exists "Staff can read cashback events"
  on public.cashback_events;
drop policy if exists "Staff can manage cashback events"
  on public.cashback_events;

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
