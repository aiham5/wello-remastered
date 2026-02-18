-- Add covering indexes for FK columns flagged by Supabase linter.
-- Safe to run multiple times.

create index if not exists app_settings_updated_by_idx
  on public.app_settings(updated_by);

create index if not exists businesses_offer_honor_policy_accepted_by_idx
  on public.businesses(offer_honor_policy_accepted_by);

create index if not exists cashback_events_parent_event_id_idx
  on public.cashback_events(parent_event_id);

create index if not exists change_requests_reviewed_by_idx
  on public.change_requests(reviewed_by);

create index if not exists change_requests_submitted_by_idx
  on public.change_requests(submitted_by);

create index if not exists commission_events_user_id_idx
  on public.commission_events(user_id);

create index if not exists offers_offer_honor_commitment_accepted_by_idx
  on public.offers(offer_honor_commitment_accepted_by);

create index if not exists purchase_verification_attempts_business_id_idx
  on public.purchase_verification_attempts(business_id);

create index if not exists purchase_verification_attempts_verification_id_idx
  on public.purchase_verification_attempts(verification_id);

create index if not exists purchase_verifications_receipt_upload_id_idx
  on public.purchase_verifications(receipt_upload_id);

create index if not exists receipt_uploads_reviewed_by_idx
  on public.receipt_uploads(reviewed_by);

create index if not exists redemptions_business_id_idx
  on public.redemptions(business_id);

create index if not exists redemptions_offer_id_idx
  on public.redemptions(offer_id);

create index if not exists redemptions_scanned_by_idx
  on public.redemptions(scanned_by);

create index if not exists referrals_qualified_cashback_event_id_idx
  on public.referrals(qualified_cashback_event_id);

create index if not exists reviews_offer_id_idx
  on public.reviews(offer_id);
