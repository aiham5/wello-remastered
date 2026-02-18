-- Stage-1 hardening with low break risk:
-- 1) Fix redemptions UPDATE policy typo.
-- 2) Restrict internal/edge-only SECURITY DEFINER function execute grants.
-- Safe to run multiple times.

-- 1) Fix typo in redemptions policy:
-- Previous buggy condition compared receipt_uploads fields to each other:
--   ru.redemption_id = ru.id
-- Correct condition should match the outer redemptions row:
--   ru.redemption_id = redemptions.id
drop policy if exists "Users can update own redemptions" on public.redemptions;

create policy "Users can update own redemptions"
on public.redemptions
for update
to public
using (
  (auth.uid() = scanned_by)
  or exists (
    select 1
    from public.receipt_uploads ru
    where ru.redemption_id = redemptions.id
      and ru.user_id = auth.uid()
  )
)
with check (
  (auth.uid() = scanned_by)
  or exists (
    select 1
    from public.receipt_uploads ru
    where ru.redemption_id = redemptions.id
      and ru.user_id = auth.uid()
  )
);

-- 2) Restrict internal/edge-only SECURITY DEFINER functions.
-- Keep `is_admin()` / `is_staff()` unchanged because they are used broadly in RLS.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.block_non_consumer_redemptions()',
    'public.cashback_events_process_referral_rewards()',
    'public.clear_profiles_promo_on_deactivate()',
    'public.count_nearby_offers_since(timestamp with time zone,double precision,double precision,integer)',
    'public.count_user_promo_uses(uuid,uuid)',
    'public.enforce_offer_redemption_limit()',
    'public.enqueue_commission_event_stripe_sync()',
    'public.ensure_referral_code(uuid)',
    'public.get_current_cashback_rate_bps()',
    'public.get_nearby_offer_digest(double precision,double precision,integer)',
    'public.get_referrer_monthly_referral_earned_cents(uuid,timestamp with time zone)',
    'public.process_referral_reward_for_cashback_event(uuid)',
    'public.receipt_uploads_set_commission_due()',
    'public.receipt_uploads_set_promo_code_id()',
    'public.require_business_offer_honor_policy()',
    'public.require_offer_honor_commitment()',
    'public.set_offer_approved_at()',
    'public.set_updated_at()',
    'public.sync_commission_event()',
    'public.sync_purchase_verification_from_receipt_upload()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated;', fn);
      execute format('grant execute on function %s to service_role;', fn);
    end if;
  end loop;
end
$$;
