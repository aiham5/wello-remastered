-- Final RLS performance cleanup:
-- - Remove remaining auth_rls_initplan warnings by using (select auth.uid()) pattern.
-- - Remove remaining multiple_permissive_policies hotspots by splitting ALL policies
--   and merging same-action checks into a single policy where possible.
-- Safe to run multiple times.

-- -----------------------------
-- app_settings (avoid SELECT overlap)
-- -----------------------------
drop policy if exists "Only admins can modify app settings" on public.app_settings;

create policy "Admins can insert app settings"
on public.app_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::text
  )
);

create policy "Admins can update app settings"
on public.app_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::text
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::text
  )
);

create policy "Admins can delete app settings"
on public.app_settings
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'::text
  )
);

-- -----------------------------
-- offers (remove ALL overlap)
-- -----------------------------
drop policy if exists "Owners can manage offers" on public.offers;
drop policy if exists "Offers insert access" on public.offers;
drop policy if exists "Offers update access" on public.offers;
drop policy if exists "Offers delete access" on public.offers;

create policy "Offers insert access"
on public.offers
for insert
to public
with check (
  (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

create policy "Offers update access"
on public.offers
for update
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
)
with check (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

create policy "Offers delete access"
on public.offers
for delete
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = (
    select b.owner_id
    from public.businesses b
    where b.id = offers.business_id
  )
);

-- -----------------------------
-- promo_codes (split staff ALL)
-- -----------------------------
drop policy if exists "promo_codes staff write" on public.promo_codes;
drop policy if exists "promo_codes staff select" on public.promo_codes;
drop policy if exists "Promo codes select access" on public.promo_codes;
drop policy if exists "Promo codes insert access" on public.promo_codes;
drop policy if exists "Promo codes update access" on public.promo_codes;
drop policy if exists "Promo codes delete access" on public.promo_codes;

create policy "Promo codes select access"
on public.promo_codes
for select
to public
using ((select public.is_staff()));

create policy "Promo codes insert access"
on public.promo_codes
for insert
to public
with check ((select public.is_staff()));

create policy "Promo codes update access"
on public.promo_codes
for update
to public
using ((select public.is_staff()))
with check ((select public.is_staff()));

create policy "Promo codes delete access"
on public.promo_codes
for delete
to public
using ((select public.is_staff()));

-- -----------------------------
-- notification_tokens (split ALL + merge SELECT)
-- -----------------------------
drop policy if exists "Users can manage notification tokens" on public.notification_tokens;
drop policy if exists "Staff can read notification tokens" on public.notification_tokens;
drop policy if exists "Notification tokens select access" on public.notification_tokens;
drop policy if exists "Users can insert own notification tokens" on public.notification_tokens;
drop policy if exists "Users can update own notification tokens" on public.notification_tokens;
drop policy if exists "Users can delete own notification tokens" on public.notification_tokens;

create policy "Notification tokens select access"
on public.notification_tokens
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

create policy "Users can insert own notification tokens"
on public.notification_tokens
for insert
to public
with check ((select auth.uid()) = user_id);

create policy "Users can update own notification tokens"
on public.notification_tokens
for update
to public
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own notification tokens"
on public.notification_tokens
for delete
to public
using ((select auth.uid()) = user_id);

-- -----------------------------
-- notification_preferences (replace ALL with per-action + initplan)
-- -----------------------------
drop policy if exists "Users can manage notification preferences" on public.notification_preferences;
drop policy if exists "Users can read own notification preferences" on public.notification_preferences;
drop policy if exists "Users can insert own notification preferences" on public.notification_preferences;
drop policy if exists "Users can update own notification preferences" on public.notification_preferences;
drop policy if exists "Users can delete own notification preferences" on public.notification_preferences;

create policy "Users can read own notification preferences"
on public.notification_preferences
for select
to public
using ((select auth.uid()) = user_id);

create policy "Users can insert own notification preferences"
on public.notification_preferences
for insert
to public
with check ((select auth.uid()) = user_id);

create policy "Users can update own notification preferences"
on public.notification_preferences
for update
to public
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own notification preferences"
on public.notification_preferences
for delete
to public
using ((select auth.uid()) = user_id);

-- -----------------------------
-- user_locations (split ALL + merge SELECT)
-- -----------------------------
drop policy if exists "Users can manage user locations" on public.user_locations;
drop policy if exists "Staff can read user locations" on public.user_locations;
drop policy if exists "User locations select access" on public.user_locations;
drop policy if exists "Users can insert own user locations" on public.user_locations;
drop policy if exists "Users can update own user locations" on public.user_locations;
drop policy if exists "Users can delete own user locations" on public.user_locations;

create policy "User locations select access"
on public.user_locations
for select
to public
using (
  (select public.is_staff())
  or (select auth.uid()) = user_id
);

create policy "Users can insert own user locations"
on public.user_locations
for insert
to public
with check ((select auth.uid()) = user_id);

create policy "Users can update own user locations"
on public.user_locations
for update
to public
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own user locations"
on public.user_locations
for delete
to public
using ((select auth.uid()) = user_id);

-- -----------------------------
-- auth_rls_initplan cleanup on user write policies
-- -----------------------------
drop policy if exists "Users can create redemptions" on public.redemptions;
create policy "Users can create redemptions"
on public.redemptions
for insert
to public
with check (
  (select auth.uid()) is not null
  and scanned_by = (select auth.uid())
);

drop policy if exists "Users can update own redemptions" on public.redemptions;
create policy "Users can update own redemptions"
on public.redemptions
for update
to public
using (
  (select auth.uid()) = scanned_by
  or exists (
    select 1
    from public.receipt_uploads ru
    where ru.redemption_id = redemptions.id
      and ru.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = scanned_by
  or exists (
    select 1
    from public.receipt_uploads ru
    where ru.redemption_id = redemptions.id
      and ru.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can create views" on public.business_views;
create policy "Users can create views"
on public.business_views
for insert
to public
with check ((select auth.uid()) = user_id);

drop policy if exists "Owners can insert businesses" on public.businesses;
create policy "Owners can insert businesses"
on public.businesses
for insert
to public
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (
  (select auth.uid()) = id
  and coalesce(role, 'consumer'::text) = any (array['consumer'::text, 'business_owner'::text])
);

drop policy if exists "Owners can create change requests" on public.change_requests;
create policy "Owners can create change requests"
on public.change_requests
for insert
to public
with check ((select auth.uid()) = submitted_by);

drop policy if exists "Users can create offer views" on public.offer_views;
create policy "Users can create offer views"
on public.offer_views
for insert
to public
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can create reviews" on public.reviews;
create policy "Users can create reviews"
on public.reviews
for insert
to public
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

drop policy if exists "Users can upload receipts" on public.receipt_uploads;
create policy "Users can upload receipts"
on public.receipt_uploads
for insert
to public
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.redemptions r
    where r.id = receipt_uploads.redemption_id
      and r.scanned_by = (select auth.uid())
  )
);

drop policy if exists "Users can create commission events" on public.commission_events;
create policy "Users can create commission events"
on public.commission_events
for insert
to public
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.redemptions r
    where r.id = commission_events.redemption_id
      and r.scanned_by = (select auth.uid())
  )
);
