-- Performance + hardening pass:
-- - Consolidate duplicate permissive RLS policies for the same role/action.
-- - Wrap auth/is_staff checks in SELECT form to improve initplan caching behavior.
-- - Remove legacy broad profile policies in favor of authenticated-scoped ones.
-- - Fix ensure_referral_code() lint warning with an explicit terminal RETURN.
-- Safe to run multiple times.

-- =========================
-- profiles (cleanup + merge)
-- =========================
drop policy if exists "Profiles are readable by owners" on public.profiles;
drop policy if exists "Profiles are editable by owners" on public.profiles;
drop policy if exists "Profiles are insertable by owners" on public.profiles;

drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Staff can read all profiles" on public.profiles;
create policy "Profiles select access"
on public.profiles
for select
to authenticated
using (
  (select public.is_staff())
  or (select auth.uid()) = id
);

drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Staff can update profiles" on public.profiles;
create policy "Profiles update access"
on public.profiles
for update
to authenticated
using (
  (select public.is_staff())
  or (select auth.uid()) = id
)
with check (
  (select public.is_staff())
  or (
    (select auth.uid()) = id
    and coalesce(role, 'consumer'::text) = any (array['consumer'::text, 'business_owner'::text])
  )
);

-- ============================================
-- Consolidate SELECT policies (public role set)
-- ============================================
drop policy if exists "Owners can read views" on public.business_views;
drop policy if exists "Staff can read views" on public.business_views;
create policy "Business views select access"
on public.business_views
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = business_views.business_id
  )
);

drop policy if exists "Businesses are public read" on public.businesses;
drop policy if exists "Owners can read own businesses" on public.businesses;
drop policy if exists "Staff can read businesses" on public.businesses;
create policy "Businesses select access"
on public.businesses
for select
to public
using (
  ((approval_status = 'approved'::text) and (status = 'active'::text))
  or (select public.is_staff())
  or (select auth.uid()) = owner_id
);

drop policy if exists "Owners can update own businesses" on public.businesses;
drop policy if exists "Staff can update businesses" on public.businesses;
create policy "Businesses update access"
on public.businesses
for update
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = owner_id
)
with check (
  (select public.is_staff())
  or (select auth.uid()) = owner_id
);

drop policy if exists "Staff can read cashback events" on public.cashback_events;
drop policy if exists "Users can read own cashback events" on public.cashback_events;
create policy "Cashback events select access"
on public.cashback_events
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Staff can read cashout bank switch events" on public.cashout_bank_switch_events;
drop policy if exists "Users can read own cashout bank switch events" on public.cashout_bank_switch_events;
create policy "Cashout switch events select access"
on public.cashout_bank_switch_events
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Staff can read cashout payouts" on public.cashout_payouts;
drop policy if exists "Users can read own cashout payouts" on public.cashout_payouts;
create policy "Cashout payouts select access"
on public.cashout_payouts
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Owners can read their change requests" on public.change_requests;
drop policy if exists "Staff can read change requests" on public.change_requests;
create policy "Change requests select access"
on public.change_requests
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = submitted_by
);

drop policy if exists "Owners can read commission events" on public.commission_events;
drop policy if exists "Staff can read commission events" on public.commission_events;
create policy "Commission events select access"
on public.commission_events
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = commission_events.business_id
  )
);

drop policy if exists "Owners can read offer views" on public.offer_views;
drop policy if exists "Staff can read offer views" on public.offer_views;
create policy "Offer views select access"
on public.offer_views
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offer_views.business_id
  )
);

drop policy if exists "Offers are public read" on public.offers;
drop policy if exists "Owners can read own offers" on public.offers;
drop policy if exists "Staff can read offers" on public.offers;
create policy "Offers select access"
on public.offers
for select
to public
using (
  ((approval_status = 'approved'::text) and (active = true))
  or (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

drop policy if exists "Staff can read plaid linked accounts" on public.plaid_linked_accounts;
drop policy if exists "Users can read own plaid linked accounts" on public.plaid_linked_accounts;
create policy "Plaid linked accounts select access"
on public.plaid_linked_accounts
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Staff can read verification attempts" on public.purchase_verification_attempts;
drop policy if exists "Users can read own verification attempts" on public.purchase_verification_attempts;
create policy "Purchase verification attempts select access"
on public.purchase_verification_attempts
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Staff can read purchase verifications" on public.purchase_verifications;
drop policy if exists "Users can read own purchase verifications" on public.purchase_verifications;
create policy "Purchase verifications select access"
on public.purchase_verifications
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Owners can read receipts" on public.receipt_uploads;
drop policy if exists "Staff can read receipts" on public.receipt_uploads;
drop policy if exists "Users can read own receipts" on public.receipt_uploads;
create policy "Receipt uploads select access"
on public.receipt_uploads
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = receipt_uploads.business_id
  )
);

drop policy if exists "Owners can read redemptions" on public.redemptions;
drop policy if exists "Staff can read redemptions" on public.redemptions;
drop policy if exists "Users can read own redemptions" on public.redemptions;
create policy "Redemptions select access"
on public.redemptions
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = scanned_by
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = redemptions.business_id
  )
);

drop policy if exists "Staff can read referral codes" on public.referral_codes;
drop policy if exists "Users can read own referral code" on public.referral_codes;
create policy "Referral codes select access"
on public.referral_codes
for select
to authenticated
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

drop policy if exists "Staff can read referrals" on public.referrals;
drop policy if exists "Users can read own referrals" on public.referrals;
create policy "Referrals select access"
on public.referrals
for select
to authenticated
using (
  (select public.is_staff())
  or (select auth.uid()) = referrer_user_id
  or (select auth.uid()) = referred_user_id
);

drop policy if exists "Users can read own reviews" on public.reviews;
drop policy if exists "Reviews are public read" on public.reviews;
create policy "Reviews are public read"
on public.reviews
for select
to public
using (true);

-- =================================
-- ensure_referral_code() lint tweak
-- =================================
create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_user_id is null then
    return null;
  end if;

  select rc.code
    into v_code
  from public.referral_codes rc
  where rc.user_id = p_user_id;

  if v_code is not null then
    return v_code;
  end if;

  loop
    v_code := upper(
      substr(
        md5(
          coalesce(p_user_id::text, '') ||
          ':' ||
          clock_timestamp()::text ||
          ':' ||
          random()::text
        ),
        1,
        10
      )
    );
    begin
      insert into public.referral_codes (user_id, code)
      values (p_user_id, v_code);
      return v_code;
    exception
      when unique_violation then
        select rc.code
          into v_code
        from public.referral_codes rc
        where rc.user_id = p_user_id;
        if v_code is not null then
          return v_code;
        end if;
    end;
  end loop;

  -- Defensive terminal return (satisfies lint).
  return null;
end;
$$;

revoke execute on function public.ensure_referral_code(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_referral_code(uuid)
  to service_role;
