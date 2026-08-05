-- Track when a business/pro account requests service from another business.
-- Money movement still uses the existing redemption, receipt, commission, and
-- cashback flows keyed by scanned_by; this migration only adds requester
-- business context and validation.

alter table public.redemptions
  add column if not exists requester_role text not null default 'consumer',
  add column if not exists requester_business_id uuid references public.businesses(id) on delete set null,
  add column if not exists requester_business_name_snapshot text;

alter table public.redemptions
  drop constraint if exists redemptions_requester_role_check;
alter table public.redemptions
  add constraint redemptions_requester_role_check
  check (requester_role in ('consumer', 'business_owner'));

create index if not exists redemptions_requester_business_id_idx
  on public.redemptions(requester_business_id);

alter table public.manual_purchase_submissions
  add column if not exists requester_role text not null default 'consumer',
  add column if not exists requester_business_id uuid references public.businesses(id) on delete set null,
  add column if not exists requester_business_name_snapshot text;

alter table public.manual_purchase_submissions
  drop constraint if exists manual_purchase_submissions_requester_role_check;
alter table public.manual_purchase_submissions
  add constraint manual_purchase_submissions_requester_role_check
  check (requester_role in ('consumer', 'business_owner'));

create index if not exists manual_purchase_submissions_requester_business_id_idx
  on public.manual_purchase_submissions(requester_business_id);

create or replace function public.block_non_consumer_redemptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  redeem_user_id uuid;
  redeem_role text;
  requester_business_name text;
begin
  redeem_user_id := coalesce(new.scanned_by, auth.uid());
  if redeem_user_id is null then
    raise exception 'Missing scanned_by user for redemption';
  end if;

  select role
    into redeem_role
  from public.profiles
  where id = redeem_user_id;

  redeem_role := coalesce(redeem_role, 'consumer');
  if redeem_role not in ('consumer', 'business_owner') then
    raise exception 'Only customer and business owner accounts can redeem offers';
  end if;

  new.requester_role := coalesce(nullif(new.requester_role, ''), redeem_role);
  if new.requester_role not in ('consumer', 'business_owner') then
    raise exception 'Invalid requester role';
  end if;

  if redeem_role = 'consumer' then
    new.requester_role := 'consumer';
    new.requester_business_id := null;
    new.requester_business_name_snapshot := null;
  end if;

  if redeem_role = 'business_owner' then
    if new.requester_role <> 'business_owner' then
      raise exception 'Business owner redemptions must include business requester context';
    end if;

    if new.requester_business_id is null then
      raise exception 'Missing requester business for business account redemption';
    end if;

    if new.requester_business_id = new.business_id then
      raise exception 'Business owners cannot earn cashback from their own business';
    end if;

    select b.name
      into requester_business_name
    from public.businesses b
    where b.id = new.requester_business_id
      and (
        b.owner_id = redeem_user_id
        or exists (
          select 1
          from public.business_members bm
          where bm.business_id = b.id
            and bm.user_id = redeem_user_id
        )
      );

    if requester_business_name is null then
      raise exception 'Requester business is not managed by this account';
    end if;

    new.requester_business_name_snapshot :=
      coalesce(nullif(new.requester_business_name_snapshot, ''), requester_business_name);
  end if;

  return new;
end;
$$;

drop policy if exists "Business members view manual purchases"
  on public.manual_purchase_submissions;
create policy "Business members view manual purchases"
  on public.manual_purchase_submissions
  for select
  to authenticated
  using (
    public.is_business_member(manual_purchase_submissions.business_id)
    or exists (
      select 1
      from public.businesses b
      where b.id = manual_purchase_submissions.business_id
        and b.owner_id = (select auth.uid())
    )
  );
