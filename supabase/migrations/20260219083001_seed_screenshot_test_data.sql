-- Screenshot seed pack for App Store / Play Store assets.
-- Creates realistic demo data after the pre-production wipe.
-- NOTE: Do not run in production-final state; use only while taking screenshots.

do $$
declare
  v_consumer_id uuid;
  v_business_owner_id uuid;
  v_admin_id uuid;
  v_friend_id uuid;

  v_promo_id uuid := '70000000-0000-4000-8000-000000000010'::uuid;

  v_biz_coffee_id uuid := '71000000-0000-4000-8000-000000000001'::uuid;
  v_biz_sushi_id uuid := '71000000-0000-4000-8000-000000000002'::uuid;
  v_biz_grill_id uuid := '71000000-0000-4000-8000-000000000003'::uuid;
  v_biz_sips_id uuid := '71000000-0000-4000-8000-000000000004'::uuid;
  v_biz_barber_id uuid := '71000000-0000-4000-8000-000000000005'::uuid;
  v_biz_carwash_id uuid := '71000000-0000-4000-8000-000000000006'::uuid;
  v_biz_bowling_id uuid := '71000000-0000-4000-8000-000000000007'::uuid;
  v_biz_autocare_id uuid := '71000000-0000-4000-8000-000000000008'::uuid;
  v_biz_pending_id uuid := '71000000-0000-4000-8000-000000000009'::uuid;

  v_offer_coffee_id uuid := '72000000-0000-4000-8000-000000000001'::uuid;
  v_offer_sushi_id uuid := '72000000-0000-4000-8000-000000000002'::uuid;
  v_offer_grill_id uuid := '72000000-0000-4000-8000-000000000003'::uuid;
  v_offer_sips_id uuid := '72000000-0000-4000-8000-000000000004'::uuid;
  v_offer_barber_id uuid := '72000000-0000-4000-8000-000000000005'::uuid;
  v_offer_carwash_id uuid := '72000000-0000-4000-8000-000000000006'::uuid;
  v_offer_bowling_id uuid := '72000000-0000-4000-8000-000000000007'::uuid;
  v_offer_autocare_id uuid := '72000000-0000-4000-8000-000000000008'::uuid;
  v_offer_pending_id uuid := '72000000-0000-4000-8000-000000000009'::uuid;

  v_redemption_1 uuid := '73000000-0000-4000-8000-000000000001'::uuid;
  v_redemption_2 uuid := '73000000-0000-4000-8000-000000000002'::uuid;
  v_redemption_3 uuid := '73000000-0000-4000-8000-000000000003'::uuid;
  v_redemption_4 uuid := '73000000-0000-4000-8000-000000000004'::uuid;

  v_receipt_1 uuid := '74000000-0000-4000-8000-000000000001'::uuid;
  v_receipt_2 uuid := '74000000-0000-4000-8000-000000000002'::uuid;
  v_receipt_3 uuid := '74000000-0000-4000-8000-000000000003'::uuid;

  v_verification_1 uuid := '75000000-0000-4000-8000-000000000001'::uuid;
  v_verification_2 uuid := '75000000-0000-4000-8000-000000000002'::uuid;
  v_verification_3 uuid := '75000000-0000-4000-8000-000000000003'::uuid;
  v_verification_4 uuid := '75000000-0000-4000-8000-000000000004'::uuid;

  v_payout_1 uuid := '76000000-0000-4000-8000-000000000001'::uuid;
  v_payout_2 uuid := '76000000-0000-4000-8000-000000000002'::uuid;

  v_cashback_1 uuid := '77000000-0000-4000-8000-000000000001'::uuid;
  v_cashback_2 uuid := '77000000-0000-4000-8000-000000000002'::uuid;
  v_cashback_3 uuid := '77000000-0000-4000-8000-000000000003'::uuid;
  v_cashback_4 uuid := '77000000-0000-4000-8000-000000000004'::uuid;
  v_cashback_referrer uuid := '77000000-0000-4000-8000-000000000005'::uuid;
  v_cashback_referred uuid := '77000000-0000-4000-8000-000000000006'::uuid;

  v_referral_id uuid := '78000000-0000-4000-8000-000000000001'::uuid;

  v_image_base text := 'https://qrohvdlntdowewhkwfub.supabase.co/storage/v1/object/public/offer-images/screenshot-seed/';
begin
  select id into v_consumer_id
  from auth.users
  where lower(email) = 'screenshots.consumer@wellopartners.com'
  order by created_at desc
  limit 1;

  select id into v_business_owner_id
  from auth.users
  where lower(email) = 'screenshots.business@wellopartners.com'
  order by created_at desc
  limit 1;

  select id into v_admin_id
  from auth.users
  where lower(email) = 'screenshots.admin@wellopartners.com'
  order by created_at desc
  limit 1;

  select id into v_friend_id
  from auth.users
  where lower(email) = 'screenshots.friend@wellopartners.com'
  order by created_at desc
  limit 1;

  if v_consumer_id is null or v_business_owner_id is null or v_admin_id is null or v_friend_id is null then
    raise exception 'Missing screenshot auth users. Create: screenshots.consumer, screenshots.business, screenshots.admin, screenshots.friend';
  end if;

  insert into public.profiles (id, full_name, email, role, phone, company, points_balance, created_at, updated_at)
  values
    (v_consumer_id, 'Sana Carter', 'screenshots.consumer@wellopartners.com', 'consumer', '+1 (312) 555-0191', null, 840, now() - interval '20 days', now()),
    (v_business_owner_id, 'Marco Diaz', 'screenshots.business@wellopartners.com', 'business_owner', '+1 (312) 555-0178', 'Wello Merchant Group', 0, now() - interval '20 days', now()),
    (v_admin_id, 'Nina Brooks', 'screenshots.admin@wellopartners.com', 'admin', '+1 (312) 555-0133', 'Wello Partners', 0, now() - interval '20 days', now()),
    (v_friend_id, 'Leo Grant', 'screenshots.friend@wellopartners.com', 'consumer', '+1 (312) 555-0142', null, 210, now() - interval '12 days', now())
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        phone = excluded.phone,
        company = excluded.company,
        points_balance = excluded.points_balance,
        updated_at = now();

  insert into public.notification_preferences (user_id, new_offer, expiring_offer, nearby_offer, created_at, updated_at)
  values (v_consumer_id, true, true, true, now() - interval '7 days', now())
  on conflict (user_id) do update
    set new_offer = excluded.new_offer,
        expiring_offer = excluded.expiring_offer,
        nearby_offer = excluded.nearby_offer,
        updated_at = now();

  insert into public.promo_codes (id, code, cashback_rate_bps, active, starts_at, ends_at, max_uses_per_user, created_at, updated_at)
  values (
    v_promo_id,
    'SCREEN10',
    1000,
    true,
    now() - interval '30 days',
    now() + interval '120 days',
    3,
    now() - interval '30 days',
    now()
  )
  on conflict (id) do update
    set code = excluded.code,
        cashback_rate_bps = excluded.cashback_rate_bps,
        active = excluded.active,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        max_uses_per_user = excluded.max_uses_per_user,
        updated_at = now();

  update public.profiles
  set promo_code_id = v_promo_id
  where id = v_consumer_id;

  insert into public.app_settings (key, value_json, updated_at, updated_by)
  values (
    'consumer_cashback_rate_bps',
    '{"bps": 5000}'::jsonb,
    now(),
    v_admin_id
  )
  on conflict (key) do update
    set value_json = excluded.value_json,
        updated_at = now(),
        updated_by = excluded.updated_by;

  insert into public.referral_codes (user_id, code, created_at, updated_at)
  values (v_consumer_id, 'WELLOVIP', now() - interval '10 days', now())
  on conflict (user_id) do update
    set code = excluded.code,
        updated_at = now();

  insert into public.businesses (
    id, owner_id, name, address, city, state, postal_code, phone,
    category_key, category_label, offer_highlight, hours, tags,
    latitude, longitude, qr_code, is_open, approval_status, status,
    stripe_account_id, stripe_customer_id, stripe_payment_method_id,
    stripe_payment_method_brand, stripe_payment_method_last4,
    stripe_charges_enabled, stripe_payouts_enabled, stripe_onboarded_at,
    commission_enabled, commission_rate_cents,
    offer_honor_policy_accepted, offer_honor_policy_version, offer_honor_policy_accepted_at, offer_honor_policy_accepted_by,
    merchant_descriptor_aliases, created_at, updated_at
  )
  values
    (v_biz_coffee_id, v_business_owner_id, 'Loop Coffee Co', '7124 W 79th St', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0101', 'cafe', 'Cafe', 'BOGO iced lattes every weekday', 'Mon-Sat 7:00 AM - 8:00 PM', array['Coffee','BOGO','Breakfast'], 41.748900, -87.798200, 'WELLO-BIZ-001', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 150, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['LOOP COFFEE','LOOP COFFEE CO'], now() - interval '18 days', now()),
    (v_biz_sushi_id, v_business_owner_id, 'Sushi Harbor', '7430 S Harlem Ave', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0102', 'restaurant', 'Restaurant / Food', '20% off signature rolls', 'Daily 11:00 AM - 10:00 PM', array['Sushi','Dinner','Family'], 41.756100, -87.801300, 'WELLO-BIZ-002', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 100, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['SUSHI HARBOR','HARBOR SUSHI'], now() - interval '17 days', now()),
    (v_biz_grill_id, v_business_owner_id, 'Sunset Grill House', '7601 S Roberts Rd', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0103', 'restaurant', 'Restaurant / Food', 'Free appetizer with entree', 'Mon-Sun 12:00 PM - 11:00 PM', array['Grill','Family','Appetizer'], 41.752300, -87.812500, 'WELLO-BIZ-003', false, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 150, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['SUNSET GRILL','SUNSET GRILL HOUSE'], now() - interval '16 days', now()),
    (v_biz_sips_id, v_business_owner_id, 'Fresh Sips Bar', '7009 W 79th St', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0104', 'drink', 'Drinks', 'Buy one smoothie, get one free', 'Daily 8:00 AM - 9:00 PM', array['Smoothie','Healthy','BOGO'], 41.749600, -87.795900, 'WELLO-BIZ-004', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 100, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['FRESH SIPS','FRESH SIPS BAR'], now() - interval '15 days', now()),
    (v_biz_barber_id, v_business_owner_id, 'Prime Cuts Barbershop', '7850 S Harlem Ave', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0105', 'barbersalon', 'Barbershop / Salon', '15% off haircut + beard trim', 'Tue-Sun 10:00 AM - 7:00 PM', array['Haircut','Style','Men'], 41.744200, -87.800300, 'WELLO-BIZ-005', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 150, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['PRIME CUTS','PRIME CUTS BARBER'], now() - interval '14 days', now()),
    (v_biz_carwash_id, v_business_owner_id, 'Shine Auto Spa', '6901 W 87th St', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0106', 'auto', 'Carwash / Auto Cosmetic', '$5 off premium wash', 'Daily 7:00 AM - 8:00 PM', array['Carwash','Auto','Detailing'], 41.732500, -87.794400, 'WELLO-BIZ-006', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 100, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['SHINE AUTO','SHINE AUTO SPA'], now() - interval '13 days', now()),
    (v_biz_bowling_id, v_business_owner_id, 'Skyline Bowling', '7400 S Harlem Ave', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0107', 'activity', 'Activities / Entertainment', '2-for-1 bowling games', 'Daily 12:00 PM - 11:30 PM', array['Family','Games','Weekend'], 41.754100, -87.807700, 'WELLO-BIZ-007', true, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 150, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['SKYLINE BOWLING','SKYLINE LANES'], now() - interval '12 days', now()),
    (v_biz_autocare_id, v_business_owner_id, 'Midtown Auto Care', '8015 S Roberts Rd', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0108', 'auto', 'Carwash / Auto Cosmetic', '10% off oil change service', 'Mon-Sat 8:00 AM - 6:00 PM', array['Oil Change','Auto','Service'], 41.741700, -87.812900, 'WELLO-BIZ-008', false, 'approved', 'active', 'acct_screen_001', 'cus_screen_001', 'pm_screen_001', 'visa', '4242', true, true, now() - interval '18 days', true, 100, true, '2026-02-17', now() - interval '18 days', v_business_owner_id, array['MIDTOWN AUTO','MIDTOWN AUTO CARE'], now() - interval '11 days', now()),
    (v_biz_pending_id, v_business_owner_id, 'Corner Test Bistro', '7901 S Harlem Ave', 'Bridgeview', 'IL', '60455', '+1 (708) 555-0110', 'restaurant', 'Restaurant / Food', 'Pending review business card', 'Mon-Fri 10:00 AM - 9:00 PM', array['Pending','Review'], 41.742800, -87.801900, 'WELLO-BIZ-009', true, 'pending', 'active', null, null, null, null, null, false, false, null, true, 150, true, '2026-02-17', now() - interval '2 days', v_business_owner_id, array['CORNER TEST BISTRO'], now() - interval '2 days', now())
  on conflict (id) do update
    set owner_id = excluded.owner_id,
        name = excluded.name,
        address = excluded.address,
        city = excluded.city,
        state = excluded.state,
        postal_code = excluded.postal_code,
        phone = excluded.phone,
        category_key = excluded.category_key,
        category_label = excluded.category_label,
        offer_highlight = excluded.offer_highlight,
        hours = excluded.hours,
        tags = excluded.tags,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        is_open = excluded.is_open,
        approval_status = excluded.approval_status,
        status = excluded.status,
        stripe_account_id = excluded.stripe_account_id,
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_payment_method_id = excluded.stripe_payment_method_id,
        stripe_payment_method_brand = excluded.stripe_payment_method_brand,
        stripe_payment_method_last4 = excluded.stripe_payment_method_last4,
        stripe_charges_enabled = excluded.stripe_charges_enabled,
        stripe_payouts_enabled = excluded.stripe_payouts_enabled,
        stripe_onboarded_at = excluded.stripe_onboarded_at,
        commission_enabled = excluded.commission_enabled,
        commission_rate_cents = excluded.commission_rate_cents,
        merchant_descriptor_aliases = excluded.merchant_descriptor_aliases,
        updated_at = now();

  insert into public.offers (
    id, business_id, title, description, offer_type, image_url, active, approval_status,
    redemption_limit_period, redemption_limit_count, approved_at,
    offer_honor_commitment_accepted, offer_honor_commitment_version, offer_honor_commitment_accepted_at, offer_honor_commitment_accepted_by,
    created_at, updated_at
  )
  values
    (v_offer_coffee_id, v_biz_coffee_id, 'Buy 1 Get 1 Iced Latte', 'Order one iced latte and get the second one free.', 'bogo', v_image_base || 'bogo-drinks.jpg', true, 'approved', 'week', 2, now() - interval '10 days', true, '2026-02-17', now() - interval '10 days', v_business_owner_id, now() - interval '10 days', now()),
    (v_offer_sushi_id, v_biz_sushi_id, '20% Off Signature Sushi Rolls', 'Save on chef specials and family platters.', 'discount', v_image_base || 'sushi-discount.jpg', true, 'approved', null, null, now() - interval '9 days', true, '2026-02-17', now() - interval '9 days', v_business_owner_id, now() - interval '9 days', now()),
    (v_offer_grill_id, v_biz_grill_id, 'Free Appetizer With Any Entree', 'Choose one free starter with your entree order.', 'free_item', v_image_base || 'appetizer-free.jpg', true, 'approved', 'week', 1, now() - interval '8 days', true, '2026-02-17', now() - interval '8 days', v_business_owner_id, now() - interval '8 days', now()),
    (v_offer_sips_id, v_biz_sips_id, 'Smoothie BOGO', 'Buy any smoothie and get a second smoothie free.', 'bogo', v_image_base || 'smoothie-bogo.jpg', true, 'approved', null, null, now() - interval '7 days', true, '2026-02-17', now() - interval '7 days', v_business_owner_id, now() - interval '7 days', now()),
    (v_offer_barber_id, v_biz_barber_id, '15% Off Haircut + Beard Trim', 'Premium grooming package discount for Wello users.', 'discount', v_image_base || 'barber-offer.jpg', true, 'approved', null, null, now() - interval '6 days', true, '2026-02-17', now() - interval '6 days', v_business_owner_id, now() - interval '6 days', now()),
    (v_offer_carwash_id, v_biz_carwash_id, '$5 Off Premium Car Wash', 'Includes exterior wash and tire shine.', 'discount', v_image_base || 'carwash-offer.jpg', true, 'approved', null, null, now() - interval '5 days', true, '2026-02-17', now() - interval '5 days', v_business_owner_id, now() - interval '5 days', now()),
    (v_offer_bowling_id, v_biz_bowling_id, '2-for-1 Bowling Games', 'Get two games for the price of one every weekday.', 'bogo', v_image_base || 'bowling-offer.jpg', true, 'approved', 'week', 2, now() - interval '4 days', true, '2026-02-17', now() - interval '4 days', v_business_owner_id, now() - interval '4 days', now()),
    (v_offer_autocare_id, v_biz_autocare_id, '10% Off Oil Change', 'Save on full-service synthetic oil change.', 'discount', v_image_base || 'oilchange-offer.jpg', true, 'approved', null, null, now() - interval '3 days', true, '2026-02-17', now() - interval '3 days', v_business_owner_id, now() - interval '3 days', now()),
    (v_offer_pending_id, v_biz_pending_id, 'Pending Review Offer', 'Used to show manager approval queue states.', 'discount', v_image_base || 'appetizer-free.jpg', true, 'pending', null, null, null, true, '2026-02-17', now() - interval '1 day', v_business_owner_id, now() - interval '1 day', now())
  on conflict (id) do update
    set business_id = excluded.business_id,
        title = excluded.title,
        description = excluded.description,
        offer_type = excluded.offer_type,
        image_url = excluded.image_url,
        active = excluded.active,
        approval_status = excluded.approval_status,
        redemption_limit_period = excluded.redemption_limit_period,
        redemption_limit_count = excluded.redemption_limit_count,
        approved_at = excluded.approved_at,
        updated_at = now();

  insert into public.redemptions (id, business_id, offer_id, qr_payload, scanned_by, created_at, points_awarded)
  values
    (v_redemption_1, v_biz_coffee_id, v_offer_coffee_id, null, v_consumer_id, now() - interval '4 days', 75),
    (v_redemption_2, v_biz_sushi_id, v_offer_sushi_id, null, v_consumer_id, now() - interval '3 days', 90),
    (v_redemption_3, v_biz_carwash_id, v_offer_carwash_id, null, v_consumer_id, now() - interval '2 days', 65),
    (v_redemption_4, v_biz_bowling_id, v_offer_bowling_id, null, v_consumer_id, now() - interval '20 hours', 80)
  on conflict (id) do update
    set business_id = excluded.business_id,
        offer_id = excluded.offer_id,
        scanned_by = excluded.scanned_by,
        created_at = excluded.created_at,
        points_awarded = excluded.points_awarded;

  insert into public.receipt_uploads (
    id, redemption_id, business_id, user_id, storage_path, uploaded_at, created_at,
    receipt_total_cents, commission_due_cents, review_status, review_notes, reviewed_by, reviewed_at,
    verification_source, verification_reference
  )
  values
    (v_receipt_1, v_redemption_1, v_biz_coffee_id, v_consumer_id, 'screenshot-seed/receipt-1.jpg', now() - interval '4 days', now() - interval '4 days', 1825, 274, 'verified', 'Verified for screenshot seed.', v_admin_id, now() - interval '4 days', 'receipt', 'seed-receipt-1'),
    (v_receipt_2, v_redemption_2, v_biz_sushi_id, v_consumer_id, 'screenshot-seed/receipt-2.jpg', now() - interval '3 days', now() - interval '3 days', 2640, 396, 'verified', 'Verified for screenshot seed.', v_admin_id, now() - interval '3 days', 'receipt', 'seed-receipt-2'),
    (v_receipt_3, v_redemption_3, v_biz_carwash_id, v_consumer_id, 'screenshot-seed/receipt-3.jpg', now() - interval '2 days', now() - interval '2 days', 4200, 420, 'pending', null, null, null, 'receipt', 'seed-receipt-3')
  on conflict (id) do update
    set review_status = excluded.review_status,
        review_notes = excluded.review_notes,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        receipt_total_cents = excluded.receipt_total_cents,
        commission_due_cents = excluded.commission_due_cents;

  insert into public.purchase_verifications (
    id, redemption_id, receipt_upload_id, business_id, user_id, source, status, reason_code, reason_detail,
    expected_amount_cents, matched_amount_cents, expected_merchant, matched_merchant,
    expected_posted_on, matched_posted_on, last_checked_at, confirmed_at, rejected_at, created_at, updated_at
  )
  values
    (v_verification_1, v_redemption_1, v_receipt_1, v_biz_coffee_id, v_consumer_id, 'receipt', 'confirmed', 'receipt_approved', 'Receipt approved.', 1825, 1825, 'Loop Coffee Co', 'Loop Coffee Co', (now() - interval '4 days')::date, (now() - interval '4 days')::date, now() - interval '4 days', now() - interval '4 days', null, now() - interval '4 days', now()),
    (v_verification_2, v_redemption_2, v_receipt_2, v_biz_sushi_id, v_consumer_id, 'receipt', 'confirmed', 'receipt_approved', 'Receipt approved.', 2640, 2640, 'Sushi Harbor', 'Sushi Harbor', (now() - interval '3 days')::date, (now() - interval '3 days')::date, now() - interval '3 days', now() - interval '3 days', null, now() - interval '3 days', now()),
    (v_verification_3, v_redemption_3, v_receipt_3, v_biz_carwash_id, v_consumer_id, 'receipt', 'pending', 'receipt_under_review', 'Receipt is awaiting staff review.', 4200, null, 'Shine Auto Spa', null, (now() - interval '2 days')::date, null, now() - interval '2 days', null, null, now() - interval '2 days', now()),
    (v_verification_4, v_redemption_4, null, v_biz_bowling_id, v_consumer_id, 'plaid', 'pending', 'transaction_pending', 'Bank transaction is pending settlement.', 3890, null, 'Skyline Bowling', null, (now() - interval '20 hours')::date, null, now() - interval '10 hours', null, null, now() - interval '20 hours', now())
  on conflict (redemption_id) do update
    set receipt_upload_id = excluded.receipt_upload_id,
        business_id = excluded.business_id,
        user_id = excluded.user_id,
        source = excluded.source,
        status = excluded.status,
        reason_code = excluded.reason_code,
        reason_detail = excluded.reason_detail,
        expected_amount_cents = excluded.expected_amount_cents,
        matched_amount_cents = excluded.matched_amount_cents,
        expected_merchant = excluded.expected_merchant,
        matched_merchant = excluded.matched_merchant,
        expected_posted_on = excluded.expected_posted_on,
        matched_posted_on = excluded.matched_posted_on,
        last_checked_at = excluded.last_checked_at,
        confirmed_at = excluded.confirmed_at,
        rejected_at = excluded.rejected_at,
        updated_at = now();

  insert into public.cashout_payouts (
    id, user_id, stripe_account_id, amount_cents, status, stripe_transfer_id, failure_reason, processed_at, created_at, updated_at
  )
  values
    (v_payout_1, v_consumer_id, 'acct_cashout_seed_001', 650, 'paid', 'tr_seed_paid_001', null, now() - interval '9 days', now() - interval '10 days', now()),
    (v_payout_2, v_consumer_id, 'acct_cashout_seed_001', 500, 'pending', null, null, null, now() - interval '2 days', now())
  on conflict (id) do update
    set amount_cents = excluded.amount_cents,
        status = excluded.status,
        processed_at = excluded.processed_at,
        updated_at = now();

  insert into public.referrals (
    id, referrer_user_id, referred_user_id, referral_code, status, claimed_at,
    qualified_cashback_event_id, referred_rewarded_at, referrer_rewarded_at, created_at, updated_at
  )
  values
    (v_referral_id, v_consumer_id, v_friend_id, 'WELLOVIP', 'rewarded_both', now() - interval '8 days', null, now() - interval '7 days', now() - interval '7 days', now() - interval '8 days', now())
  on conflict (id) do update
    set status = excluded.status,
        claimed_at = excluded.claimed_at,
        referred_rewarded_at = excluded.referred_rewarded_at,
        referrer_rewarded_at = excluded.referrer_rewarded_at,
        updated_at = now();

  insert into public.cashback_events (
    id, receipt_upload_id, redemption_id, business_id, user_id, amount_cents,
    status, payout_id, source, cashback_rate_bps, cashback_basis, platform_subsidy_cents,
    referral_id, referral_reward_role, created_at, updated_at
  )
  values
    (v_cashback_1, v_receipt_1, v_redemption_1, v_biz_coffee_id, v_consumer_id, 850, 'available', null, 'receipt', 5000, 'receipt_total', 0, null, null, now() - interval '4 days', now()),
    (v_cashback_2, v_receipt_2, v_redemption_2, v_biz_sushi_id, v_consumer_id, 650, 'paid', v_payout_1, 'receipt', 5000, 'receipt_total', 0, null, null, now() - interval '3 days', now()),
    (v_cashback_3, v_receipt_3, v_redemption_3, v_biz_carwash_id, v_consumer_id, 500, 'available', null, 'receipt', 5000, 'receipt_total', 0, null, null, now() - interval '2 days', now()),
    (v_cashback_4, null, null, null, v_consumer_id, 300, 'available', null, 'adjustment', 5000, 'receipt_total', 0, null, null, now() - interval '18 hours', now()),
    (v_cashback_referrer, null, null, null, v_consumer_id, 2000, 'available', null, 'referral', 5000, 'receipt_total', 0, v_referral_id, 'referrer', now() - interval '7 days', now()),
    (v_cashback_referred, null, null, null, v_friend_id, 2000, 'available', null, 'referral', 5000, 'receipt_total', 0, v_referral_id, 'referred', now() - interval '7 days', now())
  on conflict (id) do update
    set amount_cents = excluded.amount_cents,
        status = excluded.status,
        payout_id = excluded.payout_id,
        updated_at = now();

  insert into public.reviews (id, user_id, business_id, offer_id, redemption_id, rating, review_text, created_at)
  values
    ('79000000-0000-4000-8000-000000000001'::uuid, v_consumer_id, v_biz_coffee_id, v_offer_coffee_id, v_redemption_1, 5, 'Great coffee and fast service.', now() - interval '3 days'),
    ('79000000-0000-4000-8000-000000000002'::uuid, v_friend_id, v_biz_sushi_id, v_offer_sushi_id, null, 5, 'Fresh sushi and great portions.', now() - interval '2 days'),
    ('79000000-0000-4000-8000-000000000003'::uuid, null, v_biz_barber_id, v_offer_barber_id, null, 4, 'Clean cut and friendly team.', now() - interval '2 days'),
    ('79000000-0000-4000-8000-000000000004'::uuid, null, v_biz_bowling_id, v_offer_bowling_id, null, 5, 'Perfect family night spot.', now() - interval '1 day')
  on conflict (id) do update
    set rating = excluded.rating,
        review_text = excluded.review_text,
        created_at = excluded.created_at;

  insert into public.offer_views (id, business_id, offer_id, user_id, created_at)
  values
    ('7A000000-0000-4000-8000-000000000001'::uuid, v_biz_coffee_id, v_offer_coffee_id, v_consumer_id, now() - interval '20 hours'),
    ('7A000000-0000-4000-8000-000000000002'::uuid, v_biz_sushi_id, v_offer_sushi_id, v_consumer_id, now() - interval '18 hours'),
    ('7A000000-0000-4000-8000-000000000003'::uuid, v_biz_bowling_id, v_offer_bowling_id, v_consumer_id, now() - interval '12 hours')
  on conflict (id) do nothing;
end $$;
