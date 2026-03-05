-- Fix ambiguous column reference in account deletion RPC.
-- Root cause: unqualified request_status in RETURNING can conflict with PL/pgSQL output field name.

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
  v_request_id uuid;
  v_request_status text;
  v_request_forfeited integer := 0;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  if coalesce(p_confirm_forfeit_cashback, false) is not true then
    raise exception 'forfeit_confirmation_required';
  end if;

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
    return query
    select
      v_existing.id,
      v_existing.request_status,
      coalesce(v_existing.forfeited_cashback_cents, 0),
      v_pending_payouts;
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

  insert into public.account_deletion_requests as adr (
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
  returning
    adr.id,
    adr.request_status,
    adr.forfeited_cashback_cents
  into
    v_request_id,
    v_request_status,
    v_request_forfeited;

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

  return query
  select
    v_request_id,
    v_request_status,
    coalesce(v_request_forfeited, 0),
    v_pending_payouts;
end;
$$;

grant execute on function public.request_account_deletion(boolean) to authenticated;
