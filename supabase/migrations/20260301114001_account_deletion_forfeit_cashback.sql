-- In-app account deletion request flow with explicit cashback forfeiture.
-- Safe to run multiple times.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_status text not null default 'pending'
    check (request_status in ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  confirm_forfeit_cashback boolean not null default false,
  forfeited_cashback_cents integer not null default 0
    check (forfeited_cashback_cents >= 0),
  forfeited_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_requests_user_pending_uq
  on public.account_deletion_requests(user_id)
  where request_status = 'pending';

create index if not exists account_deletion_requests_status_created_idx
  on public.account_deletion_requests(request_status, created_at desc);

alter table public.profiles
  add column if not exists account_deletion_requested_at timestamptz,
  add column if not exists account_deletion_forfeited_cents integer not null default 0;

drop trigger if exists set_account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger set_account_deletion_requests_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;

drop policy if exists "account deletion requests owner select" on public.account_deletion_requests;
create policy "account deletion requests owner select"
on public.account_deletion_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account deletion requests staff select" on public.account_deletion_requests;
create policy "account deletion requests staff select"
on public.account_deletion_requests
for select
to authenticated
using (public.is_staff());

revoke insert, update, delete on table public.account_deletion_requests from anon, authenticated;

create or replace function public.request_account_deletion(
  p_confirm_forfeit_cashback boolean
)
returns table (
  request_id uuid,
  request_status text,
  forfeited_cashback_cents integer,
  pending_payouts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_pending_payouts integer := 0;
  v_forfeited integer := 0;
  v_existing public.account_deletion_requests;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_confirm_forfeit_cashback, false) is not true then
    raise exception 'forfeit_confirmation_required';
  end if;

  -- Serialize requests per account to avoid duplicate open requests.
  perform pg_advisory_xact_lock(hashtext('account_deletion:' || v_actor::text));

  select count(*)::integer
    into v_pending_payouts
    from public.cashout_payouts cp
    where cp.user_id = v_actor
      and lower(coalesce(cp.status, '')) = 'pending';

  if v_pending_payouts > 0 then
    raise exception 'pending_cashout_exists';
  end if;

  select adr.*
    into v_existing
    from public.account_deletion_requests adr
    where adr.user_id = v_actor
      and adr.request_status = 'pending'
    order by adr.created_at desc
    limit 1;

  if v_existing.id is not null then
    request_id := v_existing.id;
    request_status := v_existing.request_status;
    forfeited_cashback_cents := coalesce(v_existing.forfeited_cashback_cents, 0);
    pending_payouts := v_pending_payouts;
    return next;
    return;
  end if;

  with reversed_rows as (
    update public.cashback_events cbe
      set status = 'reversed',
          updated_at = now()
      where cbe.user_id = v_actor
        and cbe.status = 'available'
        and cbe.payout_id is null
      returning cbe.amount_cents
  )
  select coalesce(sum(amount_cents), 0)::integer
    into v_forfeited
    from reversed_rows;

  insert into public.account_deletion_requests (
    user_id,
    request_status,
    confirm_forfeit_cashback,
    forfeited_cashback_cents,
    forfeited_at
  )
  values (
    v_actor,
    'pending',
    true,
    v_forfeited,
    case when v_forfeited > 0 then now() else null end
  )
  returning id, request_status, forfeited_cashback_cents
    into request_id, request_status, forfeited_cashback_cents;

  insert into public.profiles (
    id,
    account_deletion_requested_at,
    account_deletion_forfeited_cents
  )
  values (
    v_actor,
    now(),
    v_forfeited
  )
  on conflict (id) do update
    set account_deletion_requested_at = excluded.account_deletion_requested_at,
        account_deletion_forfeited_cents = excluded.account_deletion_forfeited_cents;

  pending_payouts := v_pending_payouts;
  return next;
end;
$$;

grant execute on function public.request_account_deletion(boolean) to authenticated;
